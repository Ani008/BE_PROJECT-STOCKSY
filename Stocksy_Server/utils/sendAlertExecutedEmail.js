// utils/sendAlertExecutedEmail.js

const transporter = require("../config/mail");
const { alertExecutedTemplate } = require("./emailTemplates");

const sendAlertExecutedEmail = async ({
  email,
  name,
  symbol,
  action,
  quantity,
  targetPrice,
  executedPrice,
  orderId,
}) => {
  await transporter.sendMail({
    from: `"Stocksy" <${process.env.EMAIL_USER}>`,
    to: email,
    subject: `✅ GTT Executed — ${symbol}`,
    html: alertExecutedTemplate(name, symbol, action, quantity, targetPrice, executedPrice, orderId),
  });
};

module.exports = sendAlertExecutedEmail;