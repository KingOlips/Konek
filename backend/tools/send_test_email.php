<?php
/**
 * CLI smoke test for the Konek mail configuration.
 *
 * Usage:
 *   php backend/tools/send_test_email.php you@example.com
 *
 * Sends the welcome template through the configured SMTP server. It is CLI
 * only so the web server never exposes an open mail relay.
 */

if (PHP_SAPI !== "cli") {
    http_response_code(403);
    exit("CLI only\n");
}

require_once __DIR__ . "/../lib/mailer.php";

$to = $argv[1] ?? "";
if (!filter_var($to, FILTER_VALIDATE_EMAIL)) {
    fwrite(STDERR, "Usage: php backend/tools/send_test_email.php you@example.com\n");
    exit(1);
}

$config = konekMailConfig();

if (!konekMailReady()) {
    fwrite(STDERR, "Mail is not configured yet.\n");
    fwrite(STDERR, "Open backend/config/mailer.local.php and fill in username/password.\n");
    exit(1);
}

echo "Sending test email to {$to} via {$config["host"]}:{$config["port"]}...\n";

$sent = konekSendWelcomeEmail($to, "Konek tester");

if ($sent) {
    echo "Sent. Check the inbox and spam folder.\n";
    exit(0);
}

fwrite(STDERR, "Send failed. Check the PHP/Apache error log for the SMTP error.\n");
exit(1);
