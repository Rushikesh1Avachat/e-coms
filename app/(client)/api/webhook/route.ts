import { Metadata } from "@/actions/createCheckoutSession";
import stripe from "@/lib/stripe";
import { headers } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";

export async function POST(req: NextRequest) {
  const body = await req.text();
  const sig = (await headers()).get("stripe-signature");

  if (!sig) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET!;
  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(body, sig, webhookSecret);
  } catch (err: any) {
    return NextResponse.json(
      { error: `Webhook Error: ${err.message}` },
      { status: 400 }
    );
  }

  if (event.type === "checkout.session.completed") {
    await handleCheckoutSession(event.data.object as Stripe.Checkout.Session);
  }

  return NextResponse.json({ received: true });
}

async function handleCheckoutSession(session: Stripe.Checkout.Session) {
  const invoice = session.invoice
    ? await stripe.invoices.retrieve(session.invoice as string)
    : null;

  await createOrderInSanity(session, invoice);
}

async function createOrderInSanity(
  session: Stripe.Checkout.Session,
  invoice: Stripe.Invoice | null
) {
  // ✅ LAZY SANITY CLIENT (THIS FIXES BUILD)
  const { createClient } = await import("@sanity/client");

  const backendClient = createClient({
    projectId: process.env.NEXT_PUBLIC_SANITY_PROJECT_ID!,
    dataset: process.env.NEXT_PUBLIC_SANITY_DATASET!,
    apiVersion: "2024-01-01",
    token: process.env.SANITY_API_TOKEN!,
    useCdn: false,
  });

  const {
    id,
    amount_total,
    currency,
    metadata,
    payment_intent,
    total_details,
  } = session;

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
    const quantity = item.quantity || 0;
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
    clerkUserId,
    email: customerEmail,
    currency,
    totalPrice: amount_total ? amount_total / 100 : 0,
    amountDiscount: total_details?.amount_discount
      ? total_details.amount_discount / 100
      : 0,
    products: sanityProducts,
    status: "paid",
    orderDate: new Date().toISOString(),
    invoice: invoice
      ? {
          id: invoice.id,
          number: invoice.number,
          hosted_invoice_url: invoice.hosted_invoice_url,
        }
      : null,
    address: parsedAddress,
  });

  await updateStockLevels(backendClient, stockUpdates);
}

async function updateStockLevels(
  backendClient: any,
  stockUpdates: { productId: string; quantity: number }[]
) {
  for (const { productId, quantity } of stockUpdates) {
    const product = await backendClient.getDocument(productId);
    if (!product || typeof product.stock !== "number") continue;

    await backendClient
      .patch(productId)
      .set({ stock: Math.max(product.stock - quantity, 0) })
      .commit();
  }
}
