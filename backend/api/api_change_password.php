<?php
/**
 * Konek API - Change Password Endpoint
 * POST /api/api_change_password.php
 *
 * Headers: Authorization: Bearer <auth_token>
 * Request Body: {
 *   "verification_token": "string",
 *   "current_password": "string",
 *   "new_password": "string"
 * }
 * Response: { "success": bool, "message": "string" }
 *
 * A verified email code is required for every password change. Accounts that
 * already have a password must also provide the current password. The
 * verification token is single-use and is issued by api_verify_reset_code.php
 * for a `change_password` session.
 */

require_once __DIR__ . "/../config/database.php";
require_once __DIR__ . "/../config/cors.php";

// Only allow POST requests
if ($_SERVER["REQUEST_METHOD"] !== "POST") {
    http_response_code(405);
    echo json_encode(["success" => false, "message" => "Method not allowed"]);
    exit();
}

// Get auth token from the Authorization header (Apache may strip/rename it)
$authToken = requireBearerToken();

$input = json_decode(file_get_contents("php://input"), true);

if (!is_array($input) || empty($input["new_password"])) {
    http_response_code(400);
    echo json_encode(["success" => false, "message" => "New password is required"]);
    exit();
}

$currentPassword = isset($input["current_password"]) ? (string) $input["current_password"] : "";
$newPassword = (string) $input["new_password"];
$verificationToken = isset($input["verification_token"])
    ? trim((string) $input["verification_token"])
    : "";

if (strlen($newPassword) < 6) {
    http_response_code(400);
    echo json_encode(["success" => false, "message" => "New password must be at least 6 characters"]);
    exit();
}

if (strlen($newPassword) > 200) {
    http_response_code(400);
    echo json_encode(["success" => false, "message" => "New password is too long"]);
    exit();
}

if ($verificationToken === "") {
    http_response_code(400);
    echo json_encode([
        "success" => false,
        "message" => "Verify the code sent to your email before changing your password.",
    ]);
    exit();
}

try {
    $db = getDBConnection();
    $db->beginTransaction();

    $stmt = $db->prepare("
        SELECT id, password_hash, password_set
        FROM users
        WHERE auth_token = :auth_token
        LIMIT 1
        FOR UPDATE
    ");
    $stmt->bindParam(":auth_token", $authToken, PDO::PARAM_STR);
    $stmt->execute();
    $user = $stmt->fetch();

    if (!$user) {
        $db->rollBack();
        http_response_code(401);
        echo json_encode(["success" => false, "message" => "Invalid or expired token"]);
        exit();
    }

    // The token must belong to this signed-in user and to the change-password
    // flow. Reset-flow tokens are deliberately rejected here.
    $sessionStmt = $db->prepare("
        SELECT id
        FROM password_reset_sessions
        WHERE desktop_token = :desktop_token
          AND user_id = :user_id
          AND purpose = 'change_password'
          AND status = 'verified'
          AND expires_at > NOW()
        LIMIT 1
        FOR UPDATE
    ");
    $sessionStmt->bindParam(":desktop_token", $verificationToken, PDO::PARAM_STR);
    $sessionStmt->bindParam(":user_id", $user["id"], PDO::PARAM_INT);
    $sessionStmt->execute();
    $session = $sessionStmt->fetch();

    if (!$session) {
        $db->rollBack();
        http_response_code(400);
        echo json_encode([
            "success" => false,
            "message" => "This verification code is invalid or has expired. Request a new code.",
        ]);
        exit();
    }

    // Accounts that have not set a password yet (Google-created accounts still
    // completing their profile) may set one without proving the placeholder.
    if ((int) $user["password_set"] === 1) {
        if ($currentPassword === "") {
            $db->rollBack();
            http_response_code(400);
            echo json_encode(["success" => false, "message" => "Current password is required"]);
            exit();
        }

        if (!password_verify($currentPassword, $user["password_hash"])) {
            $db->rollBack();
            http_response_code(400);
            echo json_encode(["success" => false, "message" => "Current password is incorrect"]);
            exit();
        }
    }

    $newHash = password_hash($newPassword, PASSWORD_ARGON2ID);
    if ($newHash === false) {
        throw new RuntimeException("Could not hash new password");
    }

    $update = $db->prepare("UPDATE users SET password_hash = :password_hash, password_set = 1 WHERE id = :id");
    $update->bindParam(":password_hash", $newHash, PDO::PARAM_STR);
    $update->bindParam(":id", $user["id"], PDO::PARAM_INT);
    $update->execute();

    // A code is single-use; drop every outstanding change-password session.
    $deleteSessions = $db->prepare("
        DELETE FROM password_reset_sessions
        WHERE user_id = :user_id AND purpose = 'change_password'
    ");
    $deleteSessions->bindParam(":user_id", $user["id"], PDO::PARAM_INT);
    $deleteSessions->execute();

    $db->commit();

    http_response_code(200);
    echo json_encode(["success" => true, "message" => "Password updated successfully"]);
} catch (PDOException $e) {
    if (isset($db) && $db->inTransaction()) {
        $db->rollBack();
    }
    error_log("Change password error: " . $e->getMessage());
    http_response_code(500);
    echo json_encode(["success" => false, "message" => "Internal server error"]);
} catch (Throwable $e) {
    if (isset($db) && $db->inTransaction()) {
        $db->rollBack();
    }
    error_log("Change password error: " . $e->getMessage());
    http_response_code(500);
    echo json_encode(["success" => false, "message" => "Internal server error"]);
}
