<?php
/**
 * Konek API - Cross-device password reset session status
 * GET /api/api_reset_session.php?session_id=...
 *
 * Response: { "success": bool, "status": "pending"|"verified"|"expired", "token": "..."? }
 *
 * The screen that requested the reset polls this endpoint. When the user opens
 * the email and taps Verify on any device, `status` becomes `verified` and the
 * response carries the one-time token used by api_reset_password.php.
 */

require_once __DIR__ . "/../config/database.php";
require_once __DIR__ . "/../config/cors.php";

if (($_SERVER["REQUEST_METHOD"] ?? "") !== "GET") {
    http_response_code(405);
    echo json_encode(["success" => false, "message" => "Method not allowed"]);
    exit();
}

$sessionId = isset($_GET["session_id"]) ? trim((string) $_GET["session_id"]) : "";

if (preg_match("/^[a-f0-9]{64}$/i", $sessionId) !== 1) {
    http_response_code(400);
    echo json_encode([
        "success" => false,
        "status" => "expired",
        "message" => "Invalid reset session",
    ]);
    exit();
}

try {
    $db = getDBConnection();

    $stmt = $db->prepare("
        SELECT status, desktop_token, expires_at > NOW() AS is_live
        FROM password_reset_sessions
        WHERE id = :id
        LIMIT 1
    ");
    $stmt->bindParam(":id", $sessionId, PDO::PARAM_STR);
    $stmt->execute();
    $session = $stmt->fetch();

    if (!$session || (int) $session["is_live"] !== 1) {
        http_response_code(200);
        echo json_encode([
            "success" => false,
            "status" => "expired",
            "message" => "This reset request has expired. Send a new verification email.",
        ]);
        exit();
    }

    if ($session["status"] === "verified" && !empty($session["desktop_token"])) {
        echo json_encode([
            "success" => true,
            "status" => "verified",
            "token" => $session["desktop_token"],
        ]);
        exit();
    }

    echo json_encode([
        "success" => true,
        "status" => "pending",
    ]);

} catch (PDOException $e) {
    error_log("Reset session status error: " . $e->getMessage());
    http_response_code(500);
    echo json_encode([
        "success" => false,
        "status" => "pending",
        "message" => "Internal server error",
    ]);
}
