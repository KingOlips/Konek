<?php
/**
 * Konek API - Verify a password reset code
 * POST /api/api_verify_reset_code.php
 *
 * Request Body: { "session_id": "string", "code": "6 digits" }
 * Response: { "success": bool, "valid": bool, "message": "string", "token": "..."? }
 *
 * A correct code marks the reset session verified and returns a one-time token
 * used by api_reset_password.php. Five incorrect attempts invalidate the
 * session, limiting online code guessing.
 */

require_once __DIR__ . "/../config/database.php";
require_once __DIR__ . "/../config/cors.php";

if ($_SERVER["REQUEST_METHOD"] !== "POST") {
    http_response_code(405);
    echo json_encode(["success" => false, "message" => "Method not allowed"]);
    exit();
}

$input = json_decode(file_get_contents("php://input"), true);
$sessionId = is_array($input) && isset($input["session_id"])
    ? trim((string) $input["session_id"])
    : "";
$code = is_array($input) && isset($input["code"])
    ? trim((string) $input["code"])
    : "";
$maxAttempts = 5;

if (preg_match("/^[a-f0-9]{64}$/i", $sessionId) !== 1) {
    http_response_code(400);
    echo json_encode([
        "success" => false,
        "valid" => false,
        "message" => "Invalid password reset request",
    ]);
    exit();
}

if (preg_match("/^\d{6}$/", $code) !== 1) {
    http_response_code(400);
    echo json_encode([
        "success" => false,
        "valid" => false,
        "message" => "Enter the 6-digit verification code",
    ]);
    exit();
}

try {
    $db = getDBConnection();
    $db->beginTransaction();

    $stmt = $db->prepare("
        SELECT
            s.id,
            s.user_id,
            s.status,
            s.verification_code_hash,
            s.verification_attempts,
            s.expires_at > NOW() AS is_live,
            u.active_status
        FROM password_reset_sessions s
        LEFT JOIN users u ON u.id = s.user_id
        WHERE s.id = :id
        LIMIT 1
        FOR UPDATE
    ");
    $stmt->bindParam(":id", $sessionId, PDO::PARAM_STR);
    $stmt->execute();
    $session = $stmt->fetch();

    if (!$session || (int) $session["is_live"] !== 1) {
        $db->rollBack();
        http_response_code(400);
        echo json_encode([
            "success" => false,
            "valid" => false,
            "message" => "This reset request is invalid or has expired. Request a new code.",
        ]);
        exit();
    }

    if ($session["status"] !== "pending" || empty($session["verification_code_hash"])) {
        $db->rollBack();
        http_response_code(400);
        echo json_encode([
            "success" => false,
            "valid" => false,
            "message" => "This reset request is invalid or has expired. Request a new code.",
        ]);
        exit();
    }

    $attempts = (int) $session["verification_attempts"];
    if ($attempts >= $maxAttempts) {
        $deleteStmt = $db->prepare("DELETE FROM password_reset_sessions WHERE id = :id");
        $deleteStmt->bindParam(":id", $sessionId, PDO::PARAM_STR);
        $deleteStmt->execute();
        $db->commit();

        http_response_code(400);
        echo json_encode([
            "success" => false,
            "valid" => false,
            "message" => "Too many incorrect attempts. Request a new verification code.",
        ]);
        exit();
    }

    $canVerify = $session["user_id"] !== null
        && (int) $session["active_status"] === 1;
    $passwordMatches = password_verify(
        $code,
        (string) $session["verification_code_hash"]
    );
    $codeMatches = $canVerify && $passwordMatches;

    if (!$codeMatches) {
        $attempts += 1;
        $updateStmt = $db->prepare("
            UPDATE password_reset_sessions
            SET verification_attempts = :attempts
            WHERE id = :id
        ");
        $updateStmt->bindParam(":attempts", $attempts, PDO::PARAM_INT);
        $updateStmt->bindParam(":id", $sessionId, PDO::PARAM_STR);
        $updateStmt->execute();

        if ($attempts >= $maxAttempts) {
            $deleteStmt = $db->prepare("DELETE FROM password_reset_sessions WHERE id = :id");
            $deleteStmt->bindParam(":id", $sessionId, PDO::PARAM_STR);
            $deleteStmt->execute();
            $db->commit();

            http_response_code(400);
            echo json_encode([
                "success" => false,
                "valid" => false,
                "message" => "Too many incorrect attempts. Request a new verification code.",
            ]);
            exit();
        }

        $db->commit();
        http_response_code(400);
        echo json_encode([
            "success" => false,
            "valid" => false,
            "message" => "Incorrect verification code. " . ($maxAttempts - $attempts) . " attempts remaining.",
            "attempts_remaining" => $maxAttempts - $attempts,
        ]);
        exit();
    }

    $resetToken = bin2hex(random_bytes(32));
    $verifyStmt = $db->prepare("
        UPDATE password_reset_sessions
        SET status = 'verified',
            desktop_token = :desktop_token,
            verification_code_hash = NULL
        WHERE id = :id
    ");
    $verifyStmt->bindParam(":desktop_token", $resetToken, PDO::PARAM_STR);
    $verifyStmt->bindParam(":id", $sessionId, PDO::PARAM_STR);
    $verifyStmt->execute();

    $db->commit();

    http_response_code(200);
    echo json_encode([
        "success" => true,
        "valid" => true,
        "message" => "Verification code accepted",
        "token" => $resetToken,
        "attempts_remaining" => $maxAttempts - $attempts,
    ]);
} catch (PDOException $e) {
    if (isset($db) && $db->inTransaction()) {
        $db->rollBack();
    }
    error_log("Verify reset code error: " . $e->getMessage());
    http_response_code(500);
    echo json_encode([
        "success" => false,
        "valid" => false,
        "message" => "Internal server error",
    ]);
}
