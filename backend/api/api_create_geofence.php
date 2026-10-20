<?php
/**
 * Konek API - Create Geofence
 * POST /api/api_create_geofence.php
 * 
 * Headers: Authorization: Bearer <auth_token>
 * Request Body: { 
 *   "squad_id": int, 
 *   "name": "string", 
 *   "latitude": number, 
 *   "longitude": number, 
 *   "radius_meters": int 
 * }
 * Response: { "success": bool, "data": {...}, "message": "string" }
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

$required = ["squad_id", "name", "latitude", "longitude", "radius_meters"];
foreach ($required as $field) {
    if (!isset($input[$field])) {
        http_response_code(400);
        echo json_encode(["success" => false, "message" => "$field is required"]);
        exit();
    }
}

$squadId = (int)$input["squad_id"];
$name = trim($input["name"]);
$latitude = (float)$input["latitude"];
$longitude = (float)$input["longitude"];
$radiusMeters = (int)$input["radius_meters"];

// Validation
if (empty($name)) {
    http_response_code(400);
    echo json_encode(["success" => false, "message" => "Name cannot be empty"]);
    exit();
}

if (strlen($name) > 100) {
    http_response_code(400);
    echo json_encode(["success" => false, "message" => "Name too long (max 100 characters)"]);
    exit();
}

if ($latitude < -90 || $latitude > 90 || $longitude < -180 || $longitude > 180) {
    http_response_code(400);
    echo json_encode(["success" => false, "message" => "Invalid coordinates"]);
    exit();
}

if ($radiusMeters < 10 || $radiusMeters > 10000) {
    http_response_code(400);
    echo json_encode(["success" => false, "message" => "Radius must be between 10 and 10000 meters"]);
    exit();
}

try {
    $db = getDBConnection();
    
    // Get current user ID from auth token
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
    
    // Check if user is admin of this squad
    $adminStmt = $db->prepare("SELECT role FROM squad_members WHERE squad_id = :squad_id AND user_id = :user_id");
    $adminStmt->bindParam(":squad_id", $squadId, PDO::PARAM_INT);
    $adminStmt->bindParam(":user_id", $userId, PDO::PARAM_INT);
    $adminStmt->execute();
    
    $currentUser = $adminStmt->fetch(PDO::FETCH_ASSOC);
    
    if (!$currentUser || $currentUser["role"] !== "admin") {
        http_response_code(403);
        echo json_encode(["success" => false, "message" => "Only admins can create geofences"]);
        exit();
    }
    
    // Create geofence
    $insertStmt = $db->prepare("
        INSERT INTO geofences (squad_id, name, latitude, longitude, radius_meters, created_by)
        VALUES (:squad_id, :name, :latitude, :longitude, :radius_meters, :created_by)
    ");
    $insertStmt->bindParam(":squad_id", $squadId, PDO::PARAM_INT);
    $insertStmt->bindParam(":name", $name, PDO::PARAM_STR);
    $insertStmt->bindParam(":latitude", $latitude, PDO::PARAM_STR);
    $insertStmt->bindParam(":longitude", $longitude, PDO::PARAM_STR);
    $insertStmt->bindParam(":radius_meters", $radiusMeters, PDO::PARAM_INT);
    $insertStmt->bindParam(":created_by", $userId, PDO::PARAM_INT);
    $insertStmt->execute();
    
    $geofenceId = $db->lastInsertId();
    
    http_response_code(201);
    echo json_encode([
        "success" => true,
        "message" => "Geofence created successfully",
        "data" => [
            "id" => (int)$geofenceId,
            "squad_id" => $squadId,
            "name" => $name,
            "latitude" => $latitude,
            "longitude" => $longitude,
            "radius_meters" => $radiusMeters,
            "created_by" => $userId,
            "created_at" => date("Y-m-d H:i:s"),
        ]
    ]);
    
} catch (PDOException $e) {
    error_log("Create geofence error: " . $e->getMessage());
    http_response_code(500);
    echo json_encode(["success" => false, "message" => "Internal server error"]);
}
