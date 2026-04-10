import { useState } from "react";
import { Image, View, Text } from "react-native";
import type { Card } from "@yugioh/core";

interface CardImageProps {
  card: Card;
  size?: "small" | "normal" | "cropped";
  imageIndex?: number;
  style?: object;
}

export function CardImage({ card, size = "small", imageIndex = 0, style }: CardImageProps) {
  const [failed, setFailed] = useState(false);

  const image = card.card_images[imageIndex] ?? card.card_images[0];
  const uri = image
    ? size === "small"
      ? image.image_url_small
      : size === "cropped"
        ? image.image_url_cropped
        : image.image_url
    : undefined;

  if (failed || !uri) {
    return (
      <View
        style={[{ backgroundColor: "#1a1a24", alignItems: "center", justifyContent: "center" }, style]}
      >
        <Text style={{ color: "#7070a0", fontSize: 10 }}>
          {card.name.slice(0, 2).toUpperCase()}
        </Text>
      </View>
    );
  }

  return (
    <Image
      source={{ uri }}
      style={[{ resizeMode: "cover" }, style]}
      onError={() => setFailed(true)}
    />
  );
}
