<?php
/**
 * Konek API - Verify a reset token from a native app deep link
 * GET/POST /api/api_verify_reset.php?token=...
 *
 * Response: { "success": bool, "valid": bool, "message": "string" }
 *
 * When Android opens Konek directly from the email link (App Link), the
 * landing page is skipped. The app calls this endpoint instead so the
 * cross-device session is still marked verified — the desktop browser that
 * requested the reset then switches to its password form.
 */

require_once __DIR__ . "/../config/database.php";
require_once __DIR__ . "/../config/cors.php";
require_once __DIR__ . "/../lib/password_reset.php";

$input = json_decode(file_get_contents("php://input"), true);
$token = "";

if (is_array($input) && isset($input["token"])) {
    $token = trim((string) $input["token"]);
} elseif (isset($_GET["token"])) {
    $token = trim((string) $_GET["token"]);
}

if ($token === "") {
    http_response_code(400);
    echo json_encode([
        "success" => false,
        "valid" => false,
        "message" => "Reset token is required",
    ]);
    exit();
}

try {
    $db = getDBConnection();
    $result = konekVerifyResetToken($db, $token);

    http_response_code($result["valid"] ? 200 : 400);
    echo json_encode([
        "success" => $result["valid"],
        "valid" => $result["valid"],
        "message" => $result["message"],
    ]);
} catch (PDOException $e) {
    error_log("Verify reset API error: " . $e->getMessage());
    http_response_code(500);
    echo json_encode([
        "success" => false,
        "valid" => false,
        "message" => "Internal server error",
    ]);
}
