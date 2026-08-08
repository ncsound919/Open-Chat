import React, { useState } from "react";
import PropTypes from "prop-types";
import { isSafeUrl, resolveEndpoint } from "../utils/security.js";

/**
 * Resolve a possibly-relative avatar path to an absolute URL using the bot's
 * configured host/port. Relative paths like "/avatars/slug.png" come from the
 * Draymond registry and resolve against the Draymond server origin.
 */
function resolveAvatarUrl(bot) {
  const raw = bot?.avatarUrl;
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw)) return isSafeUrl(raw) ? raw : null;
  if (!raw.startsWith("/")) return null;
  const origin = resolveEndpoint(bot?.host, bot?.port, "http");
  return origin ? `${origin}${raw}` : null;
}

/**
 * Renders a bot's avatar as an image when an avatarUrl is configured
 * (e.g. a Draymond agent portrait), otherwise falls back to the emoji.
 */
export function BotAvatar({ bot, size = 44, rounded = "50%" }) {
  const [failed, setFailed] = useState(false);

  const imageUrl = resolveAvatarUrl(bot);
  const showImage = imageUrl && !failed;

  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: rounded,
        background: "#1c1c28",
        border: `1px solid ${bot?.color || "#2a2a38"}`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
        flexShrink: 0,
        fontSize: size * 0.5,
      }}
    >
      {showImage ? (
        <img
          src={imageUrl}
          alt={bot?.name || ""}
          onError={() => setFailed(true)}
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
      ) : (
        <span>{bot?.avatar || "🤖"}</span>
      )}
    </div>
  );
}

BotAvatar.propTypes = {
  bot: PropTypes.shape({
    name: PropTypes.string,
    avatar: PropTypes.string,
    avatarUrl: PropTypes.string,
    color: PropTypes.string,
    host: PropTypes.string,
    port: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
  }),
  size: PropTypes.number,
  rounded: PropTypes.string,
};
