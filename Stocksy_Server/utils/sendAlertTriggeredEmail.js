// utils/sendAlertTriggeredEmail.js

const transporter = require("../config/mail");
const { alertTriggeredTemplate } = require("./emailTemplates");

const sendAlertTriggeredEmail = async ({
  email,
  name,
  symbol,
  targetPrice,
  triggeredPrice,
  direction,
}) => {
  await transporter.sendMail({
    from: `"Stocksy" <${process.env.EMAIL_USER}>`,
    to: email,
    subject: `🔔 ${symbol} hit your target price`,
    html: alertTriggeredTemplate(name, symbol, targetPrice, triggeredPrice, direction),
  });
};

module.exports = sendAlertTriggeredEmail;