<?php
/**
 * Konek API - Request a password reset verification code
 * POST /api/api_forgot_password.php
 *
 * Request Body: { "email": "string" }
 * Response: {
 *   "success": bool,
 *   "message": "string",
 *   "session_id": "string",
 *   "verification_method": "code",
 *   "code_length": 6
 * }
 *
 * The email contains a six-digit verification code. The requesting device
 * enters that code, receives a one-time reset token, and can then save a new
 * password. The plain code is never returned by this endpoint or stored in
 * the database.
 *
 * The response is intentionally generic: it never reveals whether an email is
 * registered. A session is created in both cases, so the presence of a
 * `session_id` says nothing about the account.
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

$input = json_decode(file_get_contents("php://input"), true);
$email = isset($input["email"]) ? trim((string) $input["email"]) : "";

if ($email === "" || strlen($email) > 255 || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
    http_response_code(400);
    echo json_encode(["success" => false, "message" => "Enter a valid email address"]);
    exit();
}

$genericMessage = "If that email is registered, a 6-digit verification code is on its way. Enter it in Konek to choose a new password.";

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
        // Same status, wording, and code-verification behavior as a successful
        // send. A dummy session keeps the response shape identical; its hidden
        // code is never emailed, so it can never be verified.
        $dummyCode = str_pad((string) random_int(0, 999999), 6, "0", STR_PAD_LEFT);
        $dummyCodeHash = password_hash($dummyCode, PASSWORD_ARGON2ID);
        if ($dummyCodeHash === false) {
            throw new RuntimeException("Could not hash password reset code");
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
                NULL,
                'reset',
                :verification_code_hash,
                0,
                DATE_ADD(NOW(), INTERVAL 30 MINUTE)
            )
        ");
        $sessionStmt->bindParam(":id", $sessionId, PDO::PARAM_STR);
        $sessionStmt->bindParam(":verification_code_hash", $dummyCodeHash, PDO::PARAM_STR);
        $sessionStmt->execute();

        konekSendJsonEarly([
            "success" => true,
            "message" => $genericMessage,
            "session_id" => $sessionId,
            "verification_method" => "code",
            "code_length" => 6,
        ]);
        exit();
    }

    // Only the newest request for an account can be used.
    $deleteSessions = $db->prepare("DELETE FROM password_reset_sessions WHERE user_id = :user_id");
    $deleteSessions->bindParam(":user_id", $user["id"], PDO::PARAM_INT);
    $deleteSessions->execute();

    // Remove outstanding legacy link tokens when a new code request starts.
    $deleteResets = $db->prepare("DELETE FROM password_resets WHERE user_id = :user_id");
    $deleteResets->bindParam(":user_id", $user["id"], PDO::PARAM_INT);
    $deleteResets->execute();

    $verificationCode = str_pad((string) random_int(0, 999999), 6, "0", STR_PAD_LEFT);
    $codeHash = password_hash($verificationCode, PASSWORD_ARGON2ID);
    if ($codeHash === false) {
        throw new RuntimeException("Could not hash password reset code");
    }

    // Use the database clock: PHP and MySQL can run in different time zones,
    // and verification compares against MySQL's NOW().
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
            'reset',
            :verification_code_hash,
            0,
            DATE_ADD(NOW(), INTERVAL 30 MINUTE)
        )
    ");
    $sessionStmt->bindParam(":id", $sessionId, PDO::PARAM_STR);
    $sessionStmt->bindParam(":user_id", $user["id"], PDO::PARAM_INT);
    $sessionStmt->bindParam(":verification_code_hash", $codeHash, PDO::PARAM_STR);
    $sessionStmt->execute();

    // Answer before SMTP so the app can show the code field right away.
    konekSendJsonEarly([
        "success" => true,
        "message" => $genericMessage,
        "session_id" => $sessionId,
        "verification_method" => "code",
        "code_length" => 6,
    ]);

    if (!konekSendPasswordResetEmail($user["email"], $user["username"], $verificationCode)) {
        // The client already has the session id; remove it so a code that was
        // never delivered cannot be used.
        $cleanupSession = $db->prepare("DELETE FROM password_reset_sessions WHERE id = :id");
        $cleanupSession->bindParam(":id", $sessionId, PDO::PARAM_STR);
        $cleanupSession->execute();
        error_log("Forgot password: reset email failed for user {$user["id"]}");
    }
} catch (PDOException $e) {
    error_log("Forgot password error: " . $e->getMessage());
    http_response_code(500);
    echo json_encode(["success" => false, "message" => "Internal server error"]);
} catch (Throwable $e) {
    error_log("Forgot password error: " . $e->getMessage());
    http_response_code(500);
    echo json_encode(["success" => false, "message" => "Internal server error"]);
}
