<?php
/**
 * Konek - Password reset verification landing page
 * GET /api/reset_verify.php?token=...
 *
 * This is the target of the "Verify" button in the reset email. Tapping it
 * proves the recipient owns the mailbox. The page marks the pending reset
 * session as verified; the device where the reset was requested (for example
 * a desktop browser) is polling that session and switches to its
 * "Set a new password" form automatically.
 *
 * Nothing here links to localhost: the phone that opens the email only talks
 * to this public HTTPS page.
 */

require_once __DIR__ . "/../config/database.php";
require_once __DIR__ . "/../lib/password_reset.php";

$token = isset($_GET["token"]) ? trim((string) $_GET["token"]) : "";

$result = [
    "valid" => false,
    "message" => "This verification link is incomplete or invalid.",
];

try {
    $db = getDBConnection();
    $result = konekVerifyResetToken($db, $token);
} catch (PDOException $e) {
    error_log("Reset verify page error: " . $e->getMessage());
    $result = [
        "valid" => false,
        "message" => "We couldn't verify this link right now. Please try again.",
    ];
}

$isValid = $result["valid"] === true;
$message = $result["message"];

if (!$isValid) {
    http_response_code(400);
}

?><!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="robots" content="noindex" />
  <title><?= $isValid ? "Email verified" : "Invalid verification link" ?> - Konek</title>
  <style>
    :root { color-scheme: light; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      padding: 24px 18px;
      background: #eef2f7;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      color: #0f172a;
    }
    .card {
      width: 100%;
      max-width: 430px;
      padding: 32px 26px 28px;
      border-radius: 22px;
      background: #ffffff;
      box-shadow: 0 24px 60px rgba(15, 23, 42, 0.14);
      text-align: center;
    }
    .brand {
      display: inline-flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 22px;
    }
    .brand-mark {
      display: grid;
      place-items: center;
      width: 38px;
      height: 38px;
      border-radius: 12px;
      background: linear-gradient(135deg, #2563eb 0%, #0891b2 100%);
      color: #ffffff;
      font-weight: 800;
      font-size: 18px;
    }
    .brand-name { font-size: 20px; font-weight: 700; letter-spacing: -0.03em; }
    .icon {
      display: grid;
      place-items: center;
      width: 62px;
      height: 62px;
      margin: 0 auto 18px;
      border-radius: 50%;
      font-size: 30px;
      font-weight: 700;
    }
    .icon.success {
      background: rgba(34, 197, 94, 0.12);
      color: #16a34a;
    }
    .icon.error {
      background: rgba(220, 38, 38, 0.1);
      color: #dc2626;
    }
    h1 { margin: 0 0 10px; font-size: 23px; line-height: 1.25; letter-spacing: -0.03em; }
    p { margin: 0 0 20px; color: #64748b; font-size: 14.5px; line-height: 1.6; }
    .steps {
      margin: 22px 0 4px;
      padding: 16px 18px;
      border: 1px solid #dbeafe;
      border-radius: 14px;
      background: #eff6ff;
      text-align: left;
    }
    .steps p {
      margin: 0;
      color: #1e3a8a;
      font-size: 13.5px;
      line-height: 1.65;
    }
    .steps strong { color: #0f172a; }
    .note { margin: 18px 0 0; color: #94a3b8; font-size: 12.5px; line-height: 1.6; }
  </style>
</head>
<body>
  <main class="card">
    <div class="brand">
      <span class="brand-mark">K</span>
      <span class="brand-name">Konek</span>
    </div>

    <?php if ($isValid): ?>
      <div class="icon success">&#10003;</div>
      <h1>Email verified</h1>
      <p>
        You can close this page now. The device where you started the password
        reset has been notified and is showing the form for your new password.
      </p>
      <div class="steps">
        <p>
          <strong>Next:</strong> go back to the Konek window on the device where
          you requested the reset and choose your new password there.
        </p>
      </div>
      <p class="note">
        Requested this on this same device? Switch back to the Konek tab or app.
      </p>
    <?php else: ?>
      <div class="icon error">!</div>
      <h1>Invalid verification link</h1>
      <p><?= htmlspecialchars($message, ENT_QUOTES | ENT_SUBSTITUTE, "UTF-8") ?></p>
      <div class="steps">
        <p>
          <strong>What to do:</strong> open Konek, choose
          <strong>Forgot password</strong>, and request a new email. Links expire
          after 30 minutes.
        </p>
      </div>
    <?php endif; ?>
  </main>
</body>
</html>
