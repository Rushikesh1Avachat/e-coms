import React from 'react'
import Link from "next/link";
import {Heart, ShoppingBag} from "lucide-react";

const FavoriteButton = () => {
    return (
        <Link href={"/cart"} className="group relative">
            <Heart className="w-5 h-5 hover:text-shop_light_green hoverEffect" />
            <span className="absolute -top-1 -right-1 bg-shop_dark_green text-white h-3.5 w-3.5 rounded-full text-xs font-semibold flex items-center justify-center">
        {/*{items?.length ? items?.length : 0}*/} 0
      </span>
        </Link>
    )
}
export default FavoriteButton
