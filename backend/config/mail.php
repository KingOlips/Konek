<?php
/**
 * Konek mail delivery configuration.
 *
 * Values can come from environment variables or, for local development, from
 * backend/config/mailer.local.php (git-ignored). Copy
 * mailer.local.php.example to mailer.local.php and fill in your SMTP details.
 *
 * Gmail example:
 *   host       smtp.gmail.com
 *   port       587
 *   encryption tls
 *   username   your.name@gmail.com
 *   password   a 16-character Google App Password
 *   from_email your.name@gmail.com
 */

$config = [
    "enabled" => filter_var(getenv("KONEK_MAIL_ENABLED") ?: "1", FILTER_VALIDATE_BOOLEAN),
    "host" => getenv("KONEK_SMTP_HOST") ?: "smtp.gmail.com",
    "port" => (int) (getenv("KONEK_SMTP_PORT") ?: 587),
    "encryption" => strtolower(getenv("KONEK_SMTP_ENCRYPTION") ?: "tls"),
    "auth" => filter_var(getenv("KONEK_SMTP_AUTH") ?: "1", FILTER_VALIDATE_BOOLEAN),
    "username" => getenv("KONEK_SMTP_USER") ?: "",
    "password" => getenv("KONEK_SMTP_PASS") ?: "",
    "from_email" => getenv("KONEK_MAIL_FROM") ?: "",
    "from_name" => getenv("KONEK_MAIL_FROM_NAME") ?: "Konek",
    "app_url" => rtrim(getenv("KONEK_APP_URL") ?: "http://localhost:8100", "/"),
    // Public origin of the Konek backend, used to build HTTPS links in emails
    // (for example the password-reset Verify page). Empty means "derive from
    // the current request".
    "public_url" => rtrim((string) (getenv("KONEK_PUBLIC_URL") ?: ""), "/"),
    "debug" => filter_var(getenv("KONEK_MAIL_DEBUG") ?: "0", FILTER_VALIDATE_BOOLEAN),
    "timeout" => 15,
];

$localConfig = __DIR__ . "/mailer.local.php";
if (is_file($localConfig)) {
    $overrides = require $localConfig;
    if (is_array($overrides)) {
        $config = array_replace($config, $overrides);
    }
}

// Gmail rejects a From address that differs from the authenticated account
// unless an alias has been configured first, so default to the username.
if ($config["from_email"] === "" && $config["username"] !== "") {
    $config["from_email"] = $config["username"];
}

return $config;
