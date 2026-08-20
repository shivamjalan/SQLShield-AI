const jwt = require("jsonwebtoken");
const env = require("../config/env");

const ACCESS_TOKEN_TTL = "15m";
const REFRESH_TOKEN_TTL = "7d";

function signAccessToken(user) {
  return jwt.sign(
    { sub: user.id, email: user.email, role: user.role, type: "access" },
    env.JWT_SECRET,
    { expiresIn: ACCESS_TOKEN_TTL }
  );
}

function signRefreshToken(user) {
  return jwt.sign(
    { sub: user.id, type: "refresh" },
    env.JWT_SECRET,
    { expiresIn: REFRESH_TOKEN_TTL }
  );
}

function verifyAccessToken(token) {
  const payload = jwt.verify(token, env.JWT_SECRET);
  if (payload.type !== "access") {
    throw new Error("Not an access token");
  }
  return payload;
}

function verifyRefreshToken(token) {
  const payload = jwt.verify(token, env.JWT_SECRET);
  if (payload.type !== "refresh") {
    throw new Error("Not a refresh token");
  }
  return payload;
}

module.exports = {
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
};
