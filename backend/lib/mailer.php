<?php
/**
 * Konek mail helpers.
 *
 * Sends transactional email through PHPMailer + SMTP. Configuration lives in
 * backend/config/mail.php (environment variables or mailer.local.php).
 *
 * Every helper returns a boolean and never throws: account creation and
 * password resets must keep working when the mail server is unreachable.
 */

require_once __DIR__ . "/../vendor/PHPMailer/src/Exception.php";
require_once __DIR__ . "/../vendor/PHPMailer/src/PHPMailer.php";
require_once __DIR__ . "/../vendor/PHPMailer/src/SMTP.php";

use PHPMailer\PHPMailer\PHPMailer;

function konekMailConfig(): array
{
    static $config = null;
    if ($config === null) {
        $config = require __DIR__ . "/../config/mail.php";
    }
    return $config;
}

/** True when SMTP credentials are present and mail is not disabled. */
function konekMailReady(): bool
{
    $config = konekMailConfig();
    $hasCredentials = empty($config["auth"])
        || ((string) $config["username"] !== "" && (string) $config["password"] !== "");

    return !empty($config["enabled"])
        && !empty($config["host"])
        && !empty($config["from_email"])
        && $hasCredentials;
}

/**
 * Send one HTML email with a plain-text fallback.
 *
 * @return bool true when the SMTP server accepted the message
 */
function konekSendMail(string $toEmail, string $toName, string $subject, string $html, string $text = ""): bool
{
    $config = konekMailConfig();

    if (!konekMailReady()) {
        error_log("Konek mail: not configured, skipped email to {$toEmail}");
        return false;
    }

    $password = (string) $config["password"];
    // Google shows App Passwords in groups of four; the spaces are cosmetic.
    if (stripos((string) $config["host"], "gmail") !== false) {
        $password = str_replace(" ", "", $password);
    }

    try {
        $mail = new PHPMailer(true);
        $mail->isSMTP();
        $mail->Host = (string) $config["host"];
        $mail->Port = (int) $config["port"];
        $mail->SMTPAuth = (bool) $config["auth"];
        $mail->Username = (string) $config["username"];
        $mail->Password = $password;
        $mail->SMTPSecure = (string) $config["encryption"];
        $mail->Timeout = (int) ($config["timeout"] ?? 15);
        $mail->CharSet = "UTF-8";

        if (!empty($config["debug"])) {
            $mail->SMTPDebug = 2;
            $mail->Debugoutput = static function (string $str, int $level): void {
                error_log("Konek SMTP [{$level}]: " . rtrim($str));
            };
        }

        $mail->setFrom((string) $config["from_email"], (string) $config["from_name"]);
        $mail->addAddress($toEmail, $toName);
        $mail->Subject = $subject;
        $mail->isHTML(true);
        $mail->Body = $html;
        $mail->AltBody = $text !== "" ? $text : strip_tags(str_replace(["<br>", "<br/>", "<br />", "</p>"], "\n", $html));

        $mail->send();
        return true;
    } catch (Throwable $e) {
        error_log("Konek mail: send to {$toEmail} failed: " . $e->getMessage());
        return false;
    }
}

function konekEscape(string $value): string
{
    return htmlspecialchars($value, ENT_QUOTES | ENT_SUBSTITUTE, "UTF-8");
}

/**
 * Shared branded shell used by every Konek email. Inline styles only, since
 * Gmail and Outlook strip <style> blocks in some contexts.
 */
function konekEmailLayout(string $preheader, string $heading, string $bodyHtml): string
{
    $headingHtml = konekEscape($heading);
    $preheaderHtml = konekEscape($preheader);

    return <<<HTML
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Konek</title>
</head>
<body style="margin:0;padding:0;background:#eef2f7;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">{$preheaderHtml}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef2f7;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:20px;overflow:hidden;box-shadow:0 12px 32px rgba(15,23,42,0.08);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
          <tr>
            <td style="background:#1d4ed8;padding:22px 32px;">
              <span style="display:inline-block;width:30px;height:30px;border-radius:9px;background:#ffffff;color:#1d4ed8;font-weight:800;font-size:16px;line-height:30px;text-align:center;vertical-align:middle;">K</span>
              <span style="color:#ffffff;font-size:19px;font-weight:700;letter-spacing:-0.3px;vertical-align:middle;margin-left:10px;">Konek</span>
            </td>
          </tr>
          <tr>
            <td style="padding:36px 32px 8px;">
              <h1 style="margin:0 0 18px;color:#0f172a;font-size:24px;line-height:1.3;font-weight:700;letter-spacing:-0.4px;">{$headingHtml}</h1>
              {$bodyHtml}
            </td>
          </tr>
          <tr>
            <td style="padding:8px 32px 32px;">
              <hr style="border:none;border-top:1px solid #e6ebf2;margin:0 0 18px;" />
              <p style="margin:0;color:#94a3b8;font-size:12px;line-height:1.6;">
                Konek keeps your circle on one live map.<br />
                This message was sent automatically — please don't reply to it.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
HTML;
}

/** Welcome message sent right after a successful registration. */
function konekSendWelcomeEmail(string $toEmail, string $username): bool
{
    if (!filter_var($toEmail, FILTER_VALIDATE_EMAIL)) {
        return false;
    }

    $config = konekMailConfig();
    $appUrl = konekEscape((string) $config["app_url"]);
    $name = konekEscape($username);

    $body = <<<HTML
<p style="margin:0 0 16px;color:#334155;font-size:15px;line-height:1.7;">Hi <strong style="color:#0f172a;">{$name}</strong>,</p>
<p style="margin:0 0 24px;color:#334155;font-size:15px;line-height:1.7;">
  Your Konek account is ready. Create or join a circle and see everyone on one live map —
  no group chats, no “where are you?” calls.
</p>
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
  <tr>
    <td style="border-radius:12px;background:#1d4ed8;">
      <a href="{$appUrl}" style="display:inline-block;padding:13px 24px;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;border-radius:12px;">Open Konek</a>
    </td>
  </tr>
</table>
<p style="margin:0;color:#64748b;font-size:13px;line-height:1.7;">
  Tip: keep location sharing on while you travel so your circle can follow along in real time.
</p>
HTML;

    $text = "Hi {$username},\n\n"
        . "Your Konek account is ready. Create or join a circle and see everyone on one live map.\n\n"
        . "Open Konek: {$config["app_url"]}\n\n"
        . "Tip: keep location sharing on while you travel so your circle can follow along in real time.\n";

    return konekSendMail($toEmail, $username, "Welcome to Konek, {$username}", konekEmailLayout(
        "Your Konek account is ready.",
        "You're in, {$username}.",
        $body
    ), $text);
}

/**
 * Build the password reset email (subject, HTML, text) without sending it.
 * Kept separate so the content can be verified without SMTP.
 *
 * @return array{subject: string, html: string, text: string}
 */
function konekBuildPasswordResetEmail(string $username, string $resetUrl, string $verifyPageUrl = ""): array
{
    // Older callers only pass the web URL; keep them working.
    $primaryUrl = $verifyPageUrl !== "" ? $verifyPageUrl : $resetUrl;
    $safeVerify = konekEscape($primaryUrl);
    $name = konekEscape($username);

    $body = <<<HTML
<p style="margin:0 0 16px;color:#334155;font-size:15px;line-height:1.7;">Hi <strong style="color:#0f172a;">{$name}</strong>,</p>
<p style="margin:0 0 24px;color:#334155;font-size:15px;line-height:1.7;">
  We received a request to reset your Konek password. Tap
  <strong style="color:#0f172a;">Verify</strong> below. The screen where you
  started the reset will switch to the new-password form automatically — even
  if you opened this email on a different device. The link expires in
  <strong style="color:#0f172a;">30 minutes</strong>.
</p>
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
  <tr>
    <td style="border-radius:12px;background:#1d4ed8;">
      <a href="{$safeVerify}" style="display:inline-block;padding:13px 28px;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;border-radius:12px;">Verify</a>
    </td>
  </tr>
</table>
<p style="margin:0 0 8px;color:#64748b;font-size:13px;line-height:1.7;">
  Button not working? Copy this link into your browser:
</p>
<p style="margin:0 0 24px;word-break:break-all;color:#1d4ed8;font-size:13px;line-height:1.6;">
  <a href="{$safeVerify}" style="color:#1d4ed8;text-decoration:underline;word-break:break-all;">{$safeVerify}</a>
</p>
<p style="margin:0;color:#64748b;font-size:13px;line-height:1.7;">
  Didn't ask for this? You can safely ignore this email — your password stays the same.
</p>
HTML;

    $text = "Hi {$username},\n\n"
        . "We received a request to reset your Konek password.\n\n"
        . "Verify here: {$primaryUrl}\n\n"
        . "The screen where you started the reset will switch to the new-password form automatically, even if you open this email on another device.\n\n"
        . "The link expires in 30 minutes. If you didn't ask for this, ignore this email.\n";

    return [
        "subject" => "Verify your Konek password reset",
        "html" => konekEmailLayout(
            "Tap Verify within 30 minutes to choose a new password.",
            "Verify your password reset",
            $body
        ),
        "text" => $text,
    ];
}

/**
 * Password reset email.
 *
 * The primary "Verify" button points at an HTTPS landing page, because email
 * clients strip custom app schemes like konek://. On Android the verified App
 * Link opens the Konek app directly; everywhere else the page offers the deep
 * link and a browser fallback. The web URL below the button is the direct
 * browser reset link.
 */
function konekSendPasswordResetEmail(string $toEmail, string $username, string $resetUrl, string $verifyPageUrl = ""): bool
{
    if (!filter_var($toEmail, FILTER_VALIDATE_EMAIL)) {
        return false;
    }

    $email = konekBuildPasswordResetEmail($username, $resetUrl, $verifyPageUrl);

    return konekSendMail($toEmail, $username, $email["subject"], $email["html"], $email["text"]);
}
