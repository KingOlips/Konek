<?php
/**
 * Konek API - Reset a password with an emailed token
 * POST /api/api_reset_password.php
 *
 * Request Body: { "token": "string", "password": "string" }
 * Response: { "success": bool, "message": "string", "data": {...user} }
 *
 * On success the user is signed in: the password reset rotates the auth token
 * and returns it with the profile, so the app never has to ask for it again.
 */

require_once __DIR__ . "/../config/database.php";
require_once __DIR__ . "/../config/cors.php";

if ($_SERVER["REQUEST_METHOD"] !== "POST") {
    http_response_code(405);
    echo json_encode(["success" => false, "message" => "Method not allowed"]);
    exit();
}

$input = json_decode(file_get_contents("php://input"), true);
$token = isset($input["token"]) ? trim((string) $input["token"]) : "";
$password = isset($input["password"]) ? (string) $input["password"] : "";

if ($token === "" || $password === "") {
    http_response_code(400);
    echo json_encode(["success" => false, "message" => "Reset token and new password are required"]);
    exit();
}

if (strlen($password) < 6) {
    http_response_code(400);
    echo json_encode(["success" => false, "message" => "Password must be at least 6 characters"]);
    exit();
}

$tokenHash = hash("sha256", $token);

try {
    $db = getDBConnection();
    $db->beginTransaction();

    $stmt = $db->prepare("
        SELECT pr.id AS reset_id, pr.user_id
        FROM password_resets pr
        INNER JOIN users u ON u.id = pr.user_id
        WHERE pr.token_hash = :token_hash
          AND pr.expires_at > NOW()
          AND u.active_status = 1
        LIMIT 1
        FOR UPDATE
    ");
    $stmt->bindParam(":token_hash", $tokenHash, PDO::PARAM_STR);
    $stmt->execute();
    $reset = $stmt->fetch();

    if (!$reset) {
        // Cross-device flow: the screen that requested the reset never saw the
        // email token. Once the email link was verified, the session exposes a
        // separate one-time token for that screen.
        $sessionStmt = $db->prepare("
            SELECT s.user_id
            FROM password_reset_sessions s
            INNER JOIN users u ON u.id = s.user_id
            WHERE s.desktop_token = :desktop_token
              AND s.status = 'verified'
              AND s.expires_at > NOW()
              AND u.active_status = 1
            LIMIT 1
            FOR UPDATE
        ");
        $sessionStmt->bindParam(":desktop_token", $token, PDO::PARAM_STR);
        $sessionStmt->execute();
        $session = $sessionStmt->fetch();

        if ($session && $session["user_id"] !== null) {
            $reset = ["reset_id" => null, "user_id" => (int) $session["user_id"]];
        }
    }

    if (!$reset) {
        $db->rollBack();
        http_response_code(400);
        echo json_encode([
            "success" => false,
            "message" => "This reset link is invalid or has expired. Request a new one.",
        ]);
        exit();
    }

    $passwordHash = password_hash($password, PASSWORD_ARGON2ID);
    $authToken = bin2hex(random_bytes(32));

    $updateStmt = $db->prepare("
        UPDATE users
        SET password_hash = :password_hash, password_set = 1, auth_token = :auth_token
        WHERE id = :user_id
    ");
    $updateStmt->bindParam(":password_hash", $passwordHash, PDO::PARAM_STR);
    $updateStmt->bindParam(":auth_token", $authToken, PDO::PARAM_STR);
    $updateStmt->bindParam(":user_id", $reset["user_id"], PDO::PARAM_INT);
    $updateStmt->execute();

    // A reset link is single-use; drop every outstanding token for the user.
    $deleteStmt = $db->prepare("DELETE FROM password_resets WHERE user_id = :user_id");
    $deleteStmt->bindParam(":user_id", $reset["user_id"], PDO::PARAM_INT);
    $deleteStmt->execute();

    $deleteSessions = $db->prepare("DELETE FROM password_reset_sessions WHERE user_id = :user_id");
    $deleteSessions->bindParam(":user_id", $reset["user_id"], PDO::PARAM_INT);
    $deleteSessions->execute();

    $userStmt = $db->prepare("
        SELECT id, username, email, contact_number, profile_picture, active_status, password_set, created_at
        FROM users
        WHERE id = :user_id
        LIMIT 1
    ");
    $userStmt->bindParam(":user_id", $reset["user_id"], PDO::PARAM_INT);
    $userStmt->execute();
    $user = $userStmt->fetch();
    $user["id"] = (int) $user["id"];
    $user["active_status"] = (int) $user["active_status"];
    $user["password_set"] = (int) $user["password_set"];
    $user["auth_token"] = $authToken;

    $squadStmt = $db->prepare("
        SELECT s.id, s.squad_name, s.join_code, sm.role
        FROM squads s
        INNER JOIN squad_members sm ON s.id = sm.squad_id
        WHERE sm.user_id = :user_id
    ");
    $squadStmt->bindParam(":user_id", $reset["user_id"], PDO::PARAM_INT);
    $squadStmt->execute();
    $user["squads"] = $squadStmt->fetchAll(PDO::FETCH_ASSOC);

    $db->commit();

    http_response_code(200);
    echo json_encode([
        "success" => true,
        "message" => "Password reset successful",
        "data" => $user,
    ]);

} catch (PDOException $e) {
    if (isset($db) && $db->inTransaction()) {
        $db->rollBack();
    }
    error_log("Reset password error: " . $e->getMessage());
    http_response_code(500);
    echo json_encode(["success" => false, "message" => "Internal server error"]);
}
