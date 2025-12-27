import { Metadata } from "@/actions/createCheckoutSession";
import stripe from "@/lib/stripe";
import { backendClient } from "@/sanity/lib/backendClient";
import { headers } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";

export async function POST(req: NextRequest) {
  const body = await req.text();
  const headersList = headers();
  const sig = (await headersList).get("stripe-signature");

  if (!sig) {
    console.warn("No Stripe signature found.");
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  console.log(webhookSecret);
  
  if (!webhookSecret) {
    console.error("Stripe webhook secret not set.");
    return NextResponse.json(
      { error: "Webhook secret not configured" },
      { status: 400 }
    );
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, webhookSecret);
  } catch (err: any) {
    console.error("Stripe signature verification failed:", err.message);
    return NextResponse.json({ error: `Webhook Error: ${err.message}` }, { status: 400 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed":
        await handleCheckoutSession(event.data.object as Stripe.Checkout.Session);
        break;

      case "payment_intent.succeeded":
        // Optionally handle successful payment intents
        console.log("PaymentIntent succeeded:", event.data.object);
        break;

      case "invoice.payment_succeeded":
        console.log("Invoice payment succeeded:", event.data.object);
        break;

      default:
        console.log(`Unhandled Stripe event type: ${event.type}`);
    }
  } catch (err) {
    console.error("Error handling Stripe event:", err);
    // Still respond 200 to prevent retries unless critical
  }

  return NextResponse.json({ received: true });
}

async function handleCheckoutSession(session: Stripe.Checkout.Session) {
  const invoice = session.invoice
    ? await stripe.invoices.retrieve(session.invoice as string)
    : null;

  try {
    await createOrderInSanity(session, invoice);
  } catch (err) {
    console.error("Error creating order in Sanity:", err);
  }
}

async function createOrderInSanity(
  session: Stripe.Checkout.Session,
  invoice: Stripe.Invoice | null
) {
  const { id, amount_total, currency, metadata, payment_intent, total_details } = session;
  const { orderNumber, customerName, customerEmail, clerkUserId, address } =
    metadata as unknown as Metadata & { address: string };
  const parsedAddress = address ? JSON.parse(address) : null;

  const lineItems = await stripe.checkout.sessions.listLineItems(id, {
    expand: ["data.price.product"],
  });

  const sanityProducts: any[] = [];
  const stockUpdates: { productId: string; quantity: number }[] = [];

  for (const item of lineItems.data) {
    const productId = (item.price?.product as Stripe.Product)?.metadata?.id;
    const quantity = item?.quantity || 0;
    if (!productId) continue;

    sanityProducts.push({
      _key: crypto.randomUUID(),
      product: { _type: "reference", _ref: productId },
      quantity,
    });

    stockUpdates.push({ productId, quantity });
  }

  await backendClient.create({
    _type: "order",
    orderNumber,
    stripeCheckoutSessionId: id,
    stripePaymentIntentId: payment_intent,
    customerName,
    stripeCustomerId: customerEmail,
    clerkUserId,
    email: customerEmail,
    currency,
    amountDiscount: total_details?.amount_discount
      ? total_details.amount_discount / 100
      : 0,
    products: sanityProducts,
    totalPrice: amount_total ? amount_total / 100 : 0,
    status: "paid",
    orderDate: new Date().toISOString(),
    invoice: invoice
      ? {
          id: invoice.id,
          number: invoice.number,
          hosted_invoice_url: invoice.hosted_invoice_url,
        }
      : null,
    address: parsedAddress
      ? {
          state: parsedAddress.state,
          zip: parsedAddress.zip,
          city: parsedAddress.city,
          address: parsedAddress.address,
          name: parsedAddress.name,
        }
      : null,
  });

  await updateStockLevels(stockUpdates);
}

async function updateStockLevels(
  stockUpdates: { productId: string; quantity: number }[]
) {
  for (const { productId, quantity } of stockUpdates) {
    try {
      const product = await backendClient.getDocument(productId);
      if (!product || typeof product.stock !== "number") continue;

      const newStock = Math.max(product.stock - quantity, 0);
      await backendClient.patch(productId).set({ stock: newStock }).commit();
    } catch (err) {
      console.error(`Failed to update stock for product ${productId}:`, err);
    }
  }
}
