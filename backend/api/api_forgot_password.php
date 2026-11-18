<?php
/**
 * Konek API - Request a password reset verification email
 * POST /api/api_forgot_password.php
 *
 * Request Body: { "email": "string" }
 * Response: { "success": bool, "message": "string", "session_id": "string" }
 *
 * The email contains a "Verify" button pointing at the public HTTPS landing
 * page. The device that requested the reset (often a desktop browser) watches
 * the returned `session_id`; when the user taps Verify on any device, the
 * landing page marks the session verified and the requesting screen switches
 * to the new-password form by itself.
 *
 * The response is intentionally generic: it never reveals whether an email is
 * registered. A session is created in both cases, so the presence of a
 * `session_id` says nothing about the account.
 */

require_once __DIR__ . "/../config/database.php";
require_once __DIR__ . "/../config/cors.php";
require_once __DIR__ . "/../lib/mailer.php";

if ($_SERVER["REQUEST_METHOD"] !== "POST") {
    http_response_code(405);
    echo json_encode(["success" => false, "message" => "Method not allowed"]);
    exit();
}

$input = json_decode(file_get_contents("php://input"), true);
$email = isset($input["email"]) ? trim((string) $input["email"]) : "";

if ($email === "" || strlen($email) > 255 || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
    http_response_code(400);
    echo json_encode(["success" => false, "message" => "Enter a valid email address"]);
    exit();
}

$genericMessage = "If that email is registered, a verification link is on its way. Open it on any device and tap Verify — the screen where you started will switch to the password form.";

try {
    $db = getDBConnection();

    // Expired pending requests are never useful; clean them up opportunistically.
    $db->exec("DELETE FROM password_reset_sessions WHERE expires_at < NOW()");

    // Checked before the user lookup so registered and unknown emails behave
    // exactly the same when mail is down.
    if (!konekMailReady()) {
        error_log("Forgot password: mail is not configured");
        http_response_code(503);
        echo json_encode([
            "success" => false,
            "message" => "Password reset email is unavailable right now. Please try again later.",
        ]);
        exit();
    }

    $stmt = $db->prepare("
        SELECT id, username, email
        FROM users
        WHERE email = :email AND active_status = 1
        LIMIT 1
    ");
    $stmt->bindParam(":email", $email, PDO::PARAM_STR);
    $stmt->execute();
    $user = $stmt->fetch();

    $sessionId = bin2hex(random_bytes(32));

    if (!$user) {
        // Same status and wording as a successful send. A dummy session keeps
        // the response shape identical; it can never be verified because no
        // reset token exists for it.
        $sessionStmt = $db->prepare("
            INSERT INTO password_reset_sessions (id, user_id, expires_at)
            VALUES (:id, NULL, DATE_ADD(NOW(), INTERVAL 30 MINUTE))
        ");
        $sessionStmt->bindParam(":id", $sessionId, PDO::PARAM_STR);
        $sessionStmt->execute();

        echo json_encode([
            "success" => true,
            "message" => $genericMessage,
            "session_id" => $sessionId,
        ]);
        exit();
    }

    // Only the newest request for an account can be used.
    $deleteSessions = $db->prepare("DELETE FROM password_reset_sessions WHERE user_id = :user_id");
    $deleteSessions->bindParam(":user_id", $user["id"], PDO::PARAM_INT);
    $deleteSessions->execute();

    $deleteResets = $db->prepare("DELETE FROM password_resets WHERE user_id = :user_id");
    $deleteResets->bindParam(":user_id", $user["id"], PDO::PARAM_INT);
    $deleteResets->execute();

    $rawToken = bin2hex(random_bytes(32));
    $tokenHash = hash("sha256", $rawToken);

    $sessionStmt = $db->prepare("
        INSERT INTO password_reset_sessions (id, user_id, expires_at)
        VALUES (:id, :user_id, DATE_ADD(NOW(), INTERVAL 30 MINUTE))
    ");
    $sessionStmt->bindParam(":id", $sessionId, PDO::PARAM_STR);
    $sessionStmt->bindParam(":user_id", $user["id"], PDO::PARAM_INT);
    $sessionStmt->execute();

    // Use the database clock: PHP and MySQL can run in different time zones,
    // and the reset check compares against MySQL's NOW().
    $insertStmt = $db->prepare("
        INSERT INTO password_resets (user_id, token_hash, session_id, expires_at)
        VALUES (:user_id, :token_hash, :session_id, DATE_ADD(NOW(), INTERVAL 30 MINUTE))
    ");
    $insertStmt->bindParam(":user_id", $user["id"], PDO::PARAM_INT);
    $insertStmt->bindParam(":token_hash", $tokenHash, PDO::PARAM_STR);
    $insertStmt->bindParam(":session_id", $sessionId, PDO::PARAM_STR);
    $insertStmt->execute();

    $config = konekMailConfig();

    // Gmail and most email clients strip custom schemes (`konek://`) from
    // links, so the button is a normal HTTPS URL. It never points at the
    // developer machine: the public origin works from any network.
    $publicBase = trim((string) ($config["public_url"] ?? ""));
    if ($publicBase === "") {
        $forwardedProto = strtolower((string) ($_SERVER["HTTP_X_FORWARDED_PROTO"] ?? ""));
        $isHttps = (!empty($_SERVER["HTTPS"]) && $_SERVER["HTTPS"] !== "off")
            || $forwardedProto === "https";
        $host = (string) ($_SERVER["HTTP_HOST"] ?? "localhost");
        $publicBase = ($isHttps ? "https" : "http") . "://" . $host;
    }
    $verifyUrl = rtrim($publicBase, "/") . "/konek/backend/api/reset_verify_page.php?token=" . urlencode($rawToken);

    // The same public URL is passed twice on purpose: the reset email must
    // never contain the LAN/dev `app_url`, because the phone opening the
    // mailbox usually cannot reach the desktop's localhost.
    if (!konekSendPasswordResetEmail($user["email"], $user["username"], $verifyUrl, $verifyUrl)) {
        // Don't leave a token the user never received.
        $cleanupReset = $db->prepare("DELETE FROM password_resets WHERE token_hash = :token_hash");
        $cleanupReset->bindParam(":token_hash", $tokenHash, PDO::PARAM_STR);
        $cleanupReset->execute();

        $cleanupSession = $db->prepare("DELETE FROM password_reset_sessions WHERE id = :id");
        $cleanupSession->bindParam(":id", $sessionId, PDO::PARAM_STR);
        $cleanupSession->execute();

        http_response_code(502);
        echo json_encode([
            "success" => false,
            "message" => "We couldn't send the reset email right now. Please try again in a moment.",
        ]);
        exit();
    }

    echo json_encode([
        "success" => true,
        "message" => $genericMessage,
        "session_id" => $sessionId,
    ]);

} catch (PDOException $e) {
    error_log("Forgot password error: " . $e->getMessage());
    http_response_code(500);
    echo json_encode(["success" => false, "message" => "Internal server error"]);
}
