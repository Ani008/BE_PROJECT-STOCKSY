// utils/emailTemplates.js

const forgotPasswordTemplate = (name, otp) => {
  return `
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>Reset Your Password</title>
</head>

<body style="margin:0;padding:0;background:#f5f7fb;font-family:Arial,Helvetica,sans-serif;">

<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f7fb;padding:40px 0;">
<tr>
<td align="center">

<table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,.08);">

<tr>
<td style="background:#2563EB;padding:30px;text-align:center;">
<h1 style="margin:0;color:#ffffff;font-size:30px;">
Stocksy
</h1>
</td>
</tr>

<tr>
<td style="padding:40px;">

<h2 style="margin-top:0;color:#111827;">
Reset Your Password
</h2>

<p style="font-size:16px;color:#4B5563;line-height:26px;">
Hello ${name || "User"},
</p>

<p style="font-size:16px;color:#4B5563;line-height:26px;">
We received a request to reset the password for your Stocksy account.
Use the OTP below to continue.
</p>

<div style="margin:35px 0;text-align:center;">
<div style="
display:inline-block;
padding:18px 40px;
font-size:34px;
font-weight:bold;
letter-spacing:12px;
background:#EFF6FF;
color:#2563EB;
border-radius:12px;
border:2px dashed #2563EB;
">
${otp}
</div>
</div>

<p style="font-size:16px;color:#4B5563;line-height:26px;">
This OTP will expire in <strong>5 minutes.</strong>
</p>

<p style="font-size:16px;color:#4B5563;line-height:26px;">
If you did not request a password reset, you can safely ignore this email.
Your password will remain unchanged.
</p>

<hr style="margin:35px 0;border:none;border-top:1px solid #E5E7EB;">

<p style="font-size:13px;color:#9CA3AF;line-height:22px;">
This is a system-generated email. Please do not reply to this message.
</p>

<p style="margin-top:35px;font-size:15px;color:#374151;">
Regards,<br>
<strong>Team Stocksy</strong>
</p>

</td>
</tr>

</table>

</td>
</tr>
</table>

</body>
</html>
`;
};

const alertCreatedTemplate = (name, symbol, targetPrice, direction, action = "NOTIFY", quantity = null) => {
  const directionLabel = direction === "ABOVE" ? "rises to or above" : "falls to or below";
  const isGtt = action === "BUY" || action === "SELL";

  const headline = isGtt ? `${action === "BUY" ? "Buy" : "Sell"} GTT Created ✅` : "Price Alert Created ✅";

  const bodyLine = isGtt
    ? `Your ${action === "BUY" ? "buy" : "sell"} GTT has been set up successfully. We'll automatically place the order for you the moment it's triggered.`
    : "Your price alert has been set up successfully. We'll email you the moment it's triggered.";

  const cardSubLine = isGtt
    ? `${action === "BUY" ? "Buy" : "Sell"} ${quantity} qty when price ${directionLabel}`
    : `Notify me when price ${directionLabel}`;

  const footerLine = isGtt
    ? "If it can't be executed when triggered (for example, insufficient funds or holdings), we'll email you instead of placing a partial order. You can cancel it anytime from the Alerts screen in the app."
    : "This alert only sends a notification — it does not place any order on your behalf. You can cancel it anytime from the Alerts screen in the app.";

  return `
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>${isGtt ? "GTT Created" : "Price Alert Created"}</title>
</head>

<body style="margin:0;padding:0;background:#f5f7fb;font-family:Arial,Helvetica,sans-serif;">

<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f7fb;padding:40px 0;">
<tr>
<td align="center">

<table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,.08);">

<tr>
<td style="background:#2563EB;padding:30px;text-align:center;">
<h1 style="margin:0;color:#ffffff;font-size:30px;">
Stocksy
</h1>
</td>
</tr>

<tr>
<td style="padding:40px;">

<h2 style="margin-top:0;color:#111827;">
${headline}
</h2>

<p style="font-size:16px;color:#4B5563;line-height:26px;">
Hello ${name || "there"},
</p>

<p style="font-size:16px;color:#4B5563;line-height:26px;">
${bodyLine}
</p>

<div style="margin:35px 0;text-align:center;">
<div style="
display:inline-block;
padding:22px 40px;
background:#EFF6FF;
border-radius:12px;
border:2px dashed #2563EB;
">
<div style="font-size:20px;font-weight:bold;color:#111827;">${symbol}</div>
<div style="font-size:14px;color:#4B5563;margin-top:6px;">
${cardSubLine}
</div>
<div style="font-size:26px;font-weight:bold;color:#2563EB;margin-top:8px;">
₹${Number(targetPrice).toLocaleString("en-IN")}
</div>
</div>
</div>

<p style="font-size:16px;color:#4B5563;line-height:26px;">
${footerLine}
</p>

<hr style="margin:35px 0;border:none;border-top:1px solid #E5E7EB;">

<p style="font-size:13px;color:#9CA3AF;line-height:22px;">
This is a system-generated email. Please do not reply to this message.
</p>

<p style="margin-top:35px;font-size:15px;color:#374151;">
Regards,<br>
<strong>Team Stocksy</strong>
</p>

</td>
</tr>

</table>

</td>
</tr>
</table>

</body>
</html>
`;
};

const alertTriggeredTemplate = (name, symbol, targetPrice, triggeredPrice, direction) => {
  const directionLabel = direction === "ABOVE" ? "risen to or above" : "fallen to or below";

  return `
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>Price Alert Triggered</title>
</head>

<body style="margin:0;padding:0;background:#f5f7fb;font-family:Arial,Helvetica,sans-serif;">

<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f7fb;padding:40px 0;">
<tr>
<td align="center">

<table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,.08);">

<tr>
<td style="background:#111827;padding:30px;text-align:center;">
<h1 style="margin:0;color:#ffffff;font-size:30px;">
Stocksy
</h1>
</td>
</tr>

<tr>
<td style="padding:40px;">

<h2 style="margin-top:0;color:#111827;">
🔔 Your price alert was triggered
</h2>

<p style="font-size:16px;color:#4B5563;line-height:26px;">
Hello ${name || "there"},
</p>

<p style="font-size:16px;color:#4B5563;line-height:26px;">
<strong>${symbol}</strong> has ${directionLabel} your target of
<strong>₹${Number(targetPrice).toLocaleString("en-IN")}</strong>.
</p>

<div style="margin:35px 0;text-align:center;">
<div style="
display:inline-block;
padding:22px 40px;
background:#F0FDF4;
border-radius:12px;
border:2px dashed #16A34A;
">
<div style="font-size:20px;font-weight:bold;color:#111827;">${symbol}</div>
<div style="font-size:14px;color:#4B5563;margin-top:6px;">
Current price
</div>
<div style="font-size:26px;font-weight:bold;color:#16A34A;margin-top:8px;">
₹${Number(triggeredPrice).toLocaleString("en-IN")}
</div>
</div>
</div>

<p style="font-size:16px;color:#4B5563;line-height:26px;">
This was a notify-only alert — no order has been placed. Open the app if you'd like to act on it.
</p>

<hr style="margin:35px 0;border:none;border-top:1px solid #E5E7EB;">

<p style="font-size:13px;color:#9CA3AF;line-height:22px;">
This is a system-generated email. Please do not reply to this message.
</p>

<p style="margin-top:35px;font-size:15px;color:#374151;">
Regards,<br>
<strong>Team Stocksy</strong>
</p>

</td>
</tr>

</table>

</td>
</tr>
</table>

</body>
</html>
`;
};

const alertExecutedTemplate = (name, symbol, action, quantity, targetPrice, executedPrice, orderId) => {
  const actionLabel = action === "BUY" ? "Buy" : "Sell";

  return `
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>GTT Executed</title>
</head>

<body style="margin:0;padding:0;background:#f5f7fb;font-family:Arial,Helvetica,sans-serif;">

<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f7fb;padding:40px 0;">
<tr>
<td align="center">

<table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,.08);">

<tr>
<td style="background:#111827;padding:30px;text-align:center;">
<h1 style="margin:0;color:#ffffff;font-size:30px;">
Stocksy
</h1>
</td>
</tr>

<tr>
<td style="padding:40px;">

<h2 style="margin-top:0;color:#111827;">
✅ Your GTT order was placed
</h2>

<p style="font-size:16px;color:#4B5563;line-height:26px;">
Hello ${name || "there"},
</p>

<p style="font-size:16px;color:#4B5563;line-height:26px;">
<strong>${symbol}</strong> hit your target of <strong>₹${Number(targetPrice).toLocaleString("en-IN")}</strong>,
so we automatically placed a <strong>${actionLabel} ${quantity}</strong> delivery order for you.
</p>

<div style="margin:35px 0;text-align:center;">
<div style="
display:inline-block;
padding:22px 40px;
background:#F0FDF4;
border-radius:12px;
border:2px dashed #16A34A;
">
<div style="font-size:20px;font-weight:bold;color:#111827;">${symbol}</div>
<div style="font-size:14px;color:#4B5563;margin-top:6px;">
${actionLabel} ${quantity} · triggered at
</div>
<div style="font-size:26px;font-weight:bold;color:#16A34A;margin-top:8px;">
₹${Number(executedPrice).toLocaleString("en-IN")}
</div>
</div>
</div>

<p style="font-size:16px;color:#4B5563;line-height:26px;">
Your final fill price may differ slightly, same as any market order. You can view the confirmed fill anytime under Order History in the app${orderId ? ` (order ref: ${String(orderId).slice(0, 8)})` : ""}.
</p>

<hr style="margin:35px 0;border:none;border-top:1px solid #E5E7EB;">

<p style="font-size:13px;color:#9CA3AF;line-height:22px;">
This is a system-generated email. Please do not reply to this message.
</p>

<p style="margin-top:35px;font-size:15px;color:#374151;">
Regards,<br>
<strong>Team Stocksy</strong>
</p>

</td>
</tr>

</table>

</td>
</tr>
</table>

</body>
</html>
`;
};

const alertFailedTemplate = (name, symbol, action, quantity, targetPrice, reason) => {
  const actionLabel = action === "BUY" ? "Buy" : "Sell";

  return `
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>GTT Could Not Execute</title>
</head>

<body style="margin:0;padding:0;background:#f5f7fb;font-family:Arial,Helvetica,sans-serif;">

<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f7fb;padding:40px 0;">
<tr>
<td align="center">

<table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,.08);">

<tr>
<td style="background:#111827;padding:30px;text-align:center;">
<h1 style="margin:0;color:#ffffff;font-size:30px;">
Stocksy
</h1>
</td>
</tr>

<tr>
<td style="padding:40px;">

<h2 style="margin-top:0;color:#111827;">
⚠️ Your GTT could not be executed
</h2>

<p style="font-size:16px;color:#4B5563;line-height:26px;">
Hello ${name || "there"},
</p>

<p style="font-size:16px;color:#4B5563;line-height:26px;">
<strong>${symbol}</strong> hit your target of <strong>₹${Number(targetPrice).toLocaleString("en-IN")}</strong>,
so we tried to place a <strong>${actionLabel} ${quantity}</strong> delivery order for you — but it didn't go through.
</p>

<div style="margin:35px 0;text-align:center;">
<div style="
display:inline-block;
padding:18px 32px;
background:#FEF2F2;
border-radius:12px;
border:2px dashed #DC2626;
max-width:460px;
">
<div style="font-size:14px;color:#991B1B;font-weight:600;">
${reason || "The order could not be completed."}
</div>
</div>
</div>

<p style="font-size:16px;color:#4B5563;line-height:26px;">
This GTT has been marked as failed and won't be retried automatically. You're welcome to set it up again from the app.
</p>

<hr style="margin:35px 0;border:none;border-top:1px solid #E5E7EB;">

<p style="font-size:13px;color:#9CA3AF;line-height:22px;">
This is a system-generated email. Please do not reply to this message.
</p>

<p style="margin-top:35px;font-size:15px;color:#374151;">
Regards,<br>
<strong>Team Stocksy</strong>
</p>

</td>
</tr>

</table>

</td>
</tr>
</table>

</body>
</html>
`;
};

module.exports = {
  forgotPasswordTemplate,
  alertCreatedTemplate,
  alertTriggeredTemplate,
  alertExecutedTemplate,
  alertFailedTemplate,
};