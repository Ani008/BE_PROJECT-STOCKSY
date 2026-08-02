// utils/sendAlertCreatedEmail.js

const transporter = require("../config/mail");
const { alertCreatedTemplate } = require("./emailTemplates");

const sendAlertCreatedEmail = async ({
  email,
  name,
  symbol,
  targetPrice,
  direction,
  action = "NOTIFY",
  quantity = null,
}) => {
  const isGtt = action === "BUY" || action === "SELL";

  await transporter.sendMail({
    from: `"Stocksy" <${process.env.EMAIL_USER}>`,
    to: email,
    subject: isGtt ? `${action === "BUY" ? "Buy" : "Sell"} GTT Set — ${symbol}` : `Price Alert Set — ${symbol}`,
    html: alertCreatedTemplate(name, symbol, targetPrice, direction, action, quantity),
  });
};

module.exports = sendAlertCreatedEmail;