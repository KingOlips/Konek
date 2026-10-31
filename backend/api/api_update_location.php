<?php
/**
 * Konek API - Update User Location
 * POST /api/api_update_location.php
 * 
 * Headers: Authorization: Bearer <auth_token>
 * Request Body: { 
 *   "latitude": number, 
 *   "longitude": number, 
 *   "accuracy": number, 
 *   "altitude": number, 
 *   "speed": number, 
 *   "heading": number,
 *   "battery_level": number,   // optional, 0-100
 *   "is_charging": boolean     // optional
 * }
 * Response: { "success": bool, "message": "string" }
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

// Get JSON input
$input = json_decode(file_get_contents("php://input"), true);

if (!$input || !isset($input["latitude"]) || !isset($input["longitude"])) {
    http_response_code(400);
    echo json_encode(["success" => false, "message" => "Latitude and longitude are required"]);
    exit();
}

$latitude = (float)$input["latitude"];
$longitude = (float)$input["longitude"];
$accuracy = isset($input["accuracy"]) ? (float)$input["accuracy"] : null;
$altitude = isset($input["altitude"]) ? (float)$input["altitude"] : null;
$speed = isset($input["speed"]) ? (float)$input["speed"] : null;
$heading = isset($input["heading"]) ? (float)$input["heading"] : null;
$batteryLevel = isset($input["battery_level"]) ? max(0, min(100, (int)$input["battery_level"])) : null;
$isCharging = isset($input["is_charging"]) ? (int)(bool)$input["is_charging"] : null;

// Validate coordinates
if ($latitude < -90 || $latitude > 90 || $longitude < -180 || $longitude > 180) {
    http_response_code(400);
    echo json_encode(["success" => false, "message" => "Invalid coordinates"]);
    exit();
}

try {
    $db = getDBConnection();
    
    // Get user ID from auth token
    $stmt = $db->prepare("SELECT id FROM users WHERE auth_token = :auth_token AND active_status = 1 LIMIT 1");
    $stmt->bindParam(":auth_token", $authToken, PDO::PARAM_STR);
    $stmt->execute();
    
    $user = $stmt->fetch(PDO::FETCH_ASSOC);
    
    if (!$user) {
        http_response_code(401);
        echo json_encode(["success" => false, "message" => "Invalid or expired token"]);
        exit();
    }
    
    $userId = $user["id"];
    
    // Insert or update location (using ON DUPLICATE KEY for upsert-like behavior)
    // We always insert new location for history tracking.
    // Battery columns are optional: if the database has not been migrated yet
    // (older schema), retry without them so location updates keep working.
    $insertStmt = $db->prepare("
        INSERT INTO locations (user_id, latitude, longitude, accuracy, altitude, speed, heading, battery_level, is_charging)
        VALUES (:user_id, :latitude, :longitude, :accuracy, :altitude, :speed, :heading, :battery_level, :is_charging)
    ");
    $insertStmt->bindParam(":user_id", $userId, PDO::PARAM_INT);
    $insertStmt->bindParam(":latitude", $latitude, PDO::PARAM_STR);
    $insertStmt->bindParam(":longitude", $longitude, PDO::PARAM_STR);
    $insertStmt->bindParam(":accuracy", $accuracy, PDO::PARAM_STR);
    $insertStmt->bindParam(":altitude", $altitude, PDO::PARAM_STR);
    $insertStmt->bindParam(":speed", $speed, PDO::PARAM_STR);
    $insertStmt->bindParam(":heading", $heading, PDO::PARAM_STR);
    $insertStmt->bindParam(":battery_level", $batteryLevel, PDO::PARAM_INT);
    $insertStmt->bindParam(":is_charging", $isCharging, PDO::PARAM_INT);

    try {
        $insertStmt->execute();
    } catch (PDOException $e) {
        if (strpos($e->getMessage(), "Unknown column") === false) {
            throw $e;
        }
        error_log("locations table is missing battery columns; run the migration from database/schema.sql");
        $insertStmt = $db->prepare("
            INSERT INTO locations (user_id, latitude, longitude, accuracy, altitude, speed, heading)
            VALUES (:user_id, :latitude, :longitude, :accuracy, :altitude, :speed, :heading)
        ");
        $insertStmt->bindParam(":user_id", $userId, PDO::PARAM_INT);
        $insertStmt->bindParam(":latitude", $latitude, PDO::PARAM_STR);
        $insertStmt->bindParam(":longitude", $longitude, PDO::PARAM_STR);
        $insertStmt->bindParam(":accuracy", $accuracy, PDO::PARAM_STR);
        $insertStmt->bindParam(":altitude", $altitude, PDO::PARAM_STR);
        $insertStmt->bindParam(":speed", $speed, PDO::PARAM_STR);
        $insertStmt->bindParam(":heading", $heading, PDO::PARAM_STR);
        $insertStmt->execute();
    }
    
    // Optionally update a "current_location" cache table or user record for quick lookups
    // For now, we just return success
    
    http_response_code(200);
    echo json_encode(["success" => true, "message" => "Location updated"]);
    
} catch (PDOException $e) {
    error_log("Update location error: " . $e->getMessage());
    http_response_code(500);
    echo json_encode(["success" => false, "message" => "Internal server error"]);
}
