// utils/sendAlertFailedEmail.js

const transporter = require("../config/mail");
const { alertFailedTemplate } = require("./emailTemplates");

const sendAlertFailedEmail = async ({
  email,
  name,
  symbol,
  action,
  quantity,
  targetPrice,
  reason,
}) => {
  await transporter.sendMail({
    from: `"Stocksy" <${process.env.EMAIL_USER}>`,
    to: email,
    subject: `⚠️ GTT Could Not Execute — ${symbol}`,
    html: alertFailedTemplate(name, symbol, action, quantity, targetPrice, reason),
  });
};

module.exports = sendAlertFailedEmail;