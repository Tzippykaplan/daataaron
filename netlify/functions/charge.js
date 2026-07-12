function findStringValue(obj, keyNames) {
  if (!obj || typeof obj !== "object") return "";

  for (const [key, value] of Object.entries(obj)) {
    if (keyNames.includes(String(key).toLowerCase()) && value != null) {
      return String(value);
    }
  }

  for (const value of Object.values(obj)) {
    if (value && typeof value === "object") {
      const found = findStringValue(value, keyNames);
      if (found) return found;
    }
  }

  return "";
}

function banquestApproved(result) {
  const status = findStringValue(result, [
    "status",
    "transaction_status",
    "transactionstatus",
    "response",
    "result",
    "result_text",
    "resulttext",
    "message",
    "response_text",
    "responsetext"
  ]).toLowerCase();

  const responseCode = findStringValue(result, [
    "response_code",
    "responsecode",
    "result_code",
    "resultcode",
    "code"
  ]).toLowerCase();

  const approvedWords = ["approved", "approve", "captured", "capture", "succeeded", "success", "successful", "settled"];
  const declinedWords = ["declined", "decline", "failed", "failure", "error", "voided", "rejected", "insufficient", "denied"];

  if (declinedWords.some((word) => status.includes(word))) return false;
  if (approvedWords.some((word) => status.includes(word))) return true;

  // Common gateway convention: response/result code 0 or 00 means approved.
  if (responseCode === "0" || responseCode === "00") return true;

  return false;
}

function banquestFailureMessage(result) {
  return (
    findStringValue(result, ["error", "error_message", "errormessage", "decline_reason", "declinereason", "message", "response_text", "responsetext"]) ||
    "Payment was not approved by the gateway."
  );
}

exports.handler = async function (event) {
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        success: false,
        message: "Method not allowed. Use POST."
      })
    };
  }

  try {
    const body = JSON.parse(event.body || "{}");

    const {
      amount,
      actualDedicationAmount,
      firstName,
      lastName,
      email,
      phone,
      address,
      city,
      state,
      zip,
      memo,
      nonce,
      expiryMonth,
      expiryYear,
      avsZip,
      cardholderName
    } = body;

    const chargeAmount = Number(amount);

    if (!chargeAmount || chargeAmount <= 0 || !firstName || !lastName || !nonce) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          success: false,
          message: "Missing required payment fields."
        })
      };
    }

    const sourceKey = process.env.BANQUEST_SOURCE_KEY;
    const pin = process.env.BANQUEST_PIN;
    const apiBase =
      process.env.BANQUEST_API_BASE ||
      "https://api.banquestgateway.com/api/v2";

    if (!sourceKey || !pin) {
      return {
        statusCode: 500,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          success: false,
          message: "Missing Banquest live credentials."
        })
      };
    }

    const auth = Buffer.from(`${sourceKey}:${pin}`).toString("base64");

    const chargePayload = {
      source: `nonce-${nonce}`,
      amount: chargeAmount,
      name: cardholderName || `${firstName} ${lastName}`.trim(),
      expiry_month: expiryMonth,
      expiry_year: expiryYear,
      avs_zip: avsZip || zip,
      billing_address: {
        first_name: firstName,
        last_name: lastName,
        email,
        phone,
        street: address,
        city,
        state,
        zip
      },
      description: memo || `Dedication payment${actualDedicationAmount ? ` · dedication amount: ${actualDedicationAmount}` : ""}`
    };

    const response = await fetch(`${apiBase}/transactions/charge`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${auth}`
      },
      body: JSON.stringify(chargePayload)
    });

    let banquestResult;

    try {
      banquestResult = await response.json();
    } catch (jsonError) {
      banquestResult = {
        raw: await response.text()
      };
    }

    const approved = response.ok && banquestApproved(banquestResult);

    return {
      statusCode: approved ? 200 : 400,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        success: approved,
        message: approved ? "Payment approved." : banquestFailureMessage(banquestResult),
        chargedAmount: chargeAmount,
        banquest: banquestResult
      })
    };
  } catch (error) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        success: false,
        message: error.message
      })
    };
  }
};
