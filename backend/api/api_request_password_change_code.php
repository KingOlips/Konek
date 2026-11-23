<?php
/**
 * Konek API - Request a password change verification code
 * POST /api/api_request_password_change_code.php
 *
 * Headers: Authorization: Bearer <auth_token>
 * Request Body: {}
 * Response: {
 *   "success": bool,
 *   "message": "string",
 *   "session_id": "string",
 *   "verification_method": "code",
 *   "code_length": 6
 * }
 *
 * The signed-in user's email receives a six-digit code. Verifying that code
 * issues a one-time token that api_change_password.php requires alongside the
 * current password. Codes are stored only as Argon2id hashes and expire after
 * 10 minutes.
 */

require_once __DIR__ . "/../config/database.php";
require_once __DIR__ . "/../config/cors.php";
require_once __DIR__ . "/../lib/http.php";
require_once __DIR__ . "/../lib/mailer.php";

if ($_SERVER["REQUEST_METHOD"] !== "POST") {
    http_response_code(405);
    echo json_encode(["success" => false, "message" => "Method not allowed"]);
    exit();
}

$authToken = requireBearerToken();

try {
    $db = getDBConnection();

    // Expired pending requests are never useful; clean them up opportunistically.
    $db->exec("DELETE FROM password_reset_sessions WHERE expires_at < NOW()");

    $stmt = $db->prepare("
        SELECT id, username, email
        FROM users
        WHERE auth_token = :auth_token AND active_status = 1
        LIMIT 1
    ");
    $stmt->bindParam(":auth_token", $authToken, PDO::PARAM_STR);
    $stmt->execute();
    $user = $stmt->fetch();

    if (!$user) {
        http_response_code(401);
        echo json_encode(["success" => false, "message" => "Invalid or expired token"]);
        exit();
    }

    $email = trim((string) ($user["email"] ?? ""));
    if ($email === "" || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
        http_response_code(400);
        echo json_encode([
            "success" => false,
            "message" => "Add an email address to your account before changing your password.",
        ]);
        exit();
    }

    if (!konekMailReady()) {
        error_log("Password change code: mail is not configured");
        http_response_code(503);
        echo json_encode([
            "success" => false,
            "message" => "Verification email is unavailable right now. Please try again later.",
        ]);
        exit();
    }

    // Only the newest change-password code can be used.
    $deleteSessions = $db->prepare("
        DELETE FROM password_reset_sessions
        WHERE user_id = :user_id AND purpose = 'change_password'
    ");
    $deleteSessions->bindParam(":user_id", $user["id"], PDO::PARAM_INT);
    $deleteSessions->execute();

    $sessionId = bin2hex(random_bytes(32));
    $verificationCode = str_pad((string) random_int(0, 999999), 6, "0", STR_PAD_LEFT);
    $codeHash = password_hash($verificationCode, PASSWORD_ARGON2ID);
    if ($codeHash === false) {
        throw new RuntimeException("Could not hash password change code");
    }

    $sessionStmt = $db->prepare("
        INSERT INTO password_reset_sessions (
            id,
            user_id,
            purpose,
            verification_code_hash,
            verification_attempts,
            expires_at
        )
        VALUES (
            :id,
            :user_id,
            'change_password',
            :verification_code_hash,
            0,
            DATE_ADD(NOW(), INTERVAL 10 MINUTE)
        )
    ");
    $sessionStmt->bindParam(":id", $sessionId, PDO::PARAM_STR);
    $sessionStmt->bindParam(":user_id", $user["id"], PDO::PARAM_INT);
    $sessionStmt->bindParam(":verification_code_hash", $codeHash, PDO::PARAM_STR);
    $sessionStmt->execute();

    // Answer before SMTP so the app can show the code field right away.
    konekSendJsonEarly([
        "success" => true,
        "message" => "A 6-digit verification code was sent to your email.",
        "session_id" => $sessionId,
        "verification_method" => "code",
        "code_length" => 6,
    ]);

    if (!konekSendPasswordChangeEmail($email, $user["username"], $verificationCode)) {
        // The client already has the session id; remove it so a code that was
        // never delivered cannot be used.
        $cleanupSession = $db->prepare("DELETE FROM password_reset_sessions WHERE id = :id");
        $cleanupSession->bindParam(":id", $sessionId, PDO::PARAM_STR);
        $cleanupSession->execute();
        error_log("Password change code: email failed for user {$user["id"]}");
    }
} catch (PDOException $e) {
    error_log("Password change code error: " . $e->getMessage());
    http_response_code(500);
    echo json_encode(["success" => false, "message" => "Internal server error"]);
} catch (Throwable $e) {
    error_log("Password change code error: " . $e->getMessage());
    http_response_code(500);
    echo json_encode(["success" => false, "message" => "Internal server error"]);
}
