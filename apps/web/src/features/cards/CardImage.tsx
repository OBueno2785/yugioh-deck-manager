import { useState } from "react";
import type { Card } from "@yugioh/core";

interface CardImageProps {
  card: Card;
  size?: "small" | "normal" | "cropped";
  /** Which art variant to show (index into card.card_images). Default 0. */
  imageIndex?: number;
  className?: string;
  style?: React.CSSProperties;
  alt?: string;
}

export function CardImage({
  card,
  size = "small",
  imageIndex = 0,
  className = "",
  style,
  alt,
}: CardImageProps) {
  const [failed, setFailed] = useState(false);

  const image = card.card_images[imageIndex] ?? card.card_images[0];
  const src = image
    ? size === "small"
      ? image.image_url_small
      : size === "cropped"
        ? image.image_url_cropped
        : image.image_url
    : undefined;

  if (failed || !src) {
    return (
      <div
        className={`flex items-center justify-center bg-gray-800 text-gray-500 text-xs ${className}`}
        style={style}
        title={card.name}
      >
        {card.name.slice(0, 2).toUpperCase()}
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt ?? card.name}
      className={className}
      style={style}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}
