<?php
/**
 * Send a JSON response and keep running.
 *
 * SMTP delivery can take several seconds. Password endpoints use this helper
 * so the app receives its session id immediately and can show the verification
 * code form while the email is still being handed to the mail server.
 */

/**
 * @param array<string, mixed> $payload
 */
function konekSendJsonEarly(array $payload): void
{
    $body = json_encode($payload);
    if ($body === false) {
        $body = json_encode([
            "success" => false,
            "message" => "Internal server error",
        ]);
    }

    // Keep the script alive after the browser has its answer.
    ignore_user_abort(true);

    if (!headers_sent()) {
        header("Content-Type: application/json; charset=UTF-8");
        header("Content-Length: " . strlen($body));
    }

    echo $body;

    while (ob_get_level() > 0) {
        @ob_end_flush();
    }
    flush();
}
