<?php
/**
 * Konek API - User Registration Endpoint
 * POST /api/api_register.php
 * 
 * Request Body: { "username": "string", "password": "string" }
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

// Get JSON input
$input = json_decode(file_get_contents("php://input"), true);

if (!$input || !isset($input["username"]) || !isset($input["password"])) {
    http_response_code(400);
    echo json_encode(["success" => false, "message" => "Username and password are required"]);
    exit();
}

$username = trim($input["username"]);
$password = $input["password"];
$email = isset($input["email"]) ? trim((string) $input["email"]) : "";

// Validation
if (empty($username) || empty($password)) {
    http_response_code(400);
    echo json_encode(["success" => false, "message" => "Username and password cannot be empty"]);
    exit();
}

if (strlen($username) < 3) {
    http_response_code(400);
    echo json_encode(["success" => false, "message" => "Username must be at least 3 characters"]);
    exit();
}

if ($email !== "" && (strlen($email) > 255 || !filter_var($email, FILTER_VALIDATE_EMAIL))) {
    http_response_code(400);
    echo json_encode(["success" => false, "message" => "Enter a valid email address"]);
    exit();
}

if (strlen($password) < 6) {
    http_response_code(400);
    echo json_encode(["success" => false, "message" => "Password must be at least 6 characters"]);
    exit();
}

if (!preg_match("/^[a-zA-Z0-9_]+$/", $username)) {
    http_response_code(400);
    echo json_encode(["success" => false, "message" => "Username can only contain letters, numbers, and underscores"]);
    exit();
}

try {
    $db = getDBConnection();
    
    // Check if username already exists
    $stmt = $db->prepare("SELECT id FROM users WHERE username = :username LIMIT 1");
    $stmt->bindParam(":username", $username, PDO::PARAM_STR);
    $stmt->execute();
    
    if ($stmt->fetch()) {
        http_response_code(409);
        echo json_encode(["success" => false, "message" => "Username already taken"]);
        exit();
    }

    // Check if email already exists
    if ($email !== "") {
        $emailStmt = $db->prepare("SELECT id FROM users WHERE email = :email LIMIT 1");
        $emailStmt->bindParam(":email", $email, PDO::PARAM_STR);
        $emailStmt->execute();

        if ($emailStmt->fetch()) {
            http_response_code(409);
            echo json_encode(["success" => false, "message" => "Email is already registered"]);
            exit();
        }
    }

    // Hash password
    $passwordHash = password_hash($password, PASSWORD_ARGON2ID);

    // Insert new user
    $emailValue = $email === "" ? null : $email;
    $insertStmt = $db->prepare("INSERT INTO users (username, email, password_hash, active_status) VALUES (:username, :email, :password_hash, 1)");
    $insertStmt->bindParam(":username", $username, PDO::PARAM_STR);
    $insertStmt->bindValue(":email", $emailValue, $emailValue === null ? PDO::PARAM_NULL : PDO::PARAM_STR);
    $insertStmt->bindParam(":password_hash", $passwordHash, PDO::PARAM_STR);
    $insertStmt->execute();
    
    $userId = $db->lastInsertId();
    
    // Generate auth token for auto-login
    $authToken = bin2hex(random_bytes(32));
    $updateStmt = $db->prepare("UPDATE users SET auth_token = :auth_token WHERE id = :id");
    $updateStmt->bindParam(":auth_token", $authToken, PDO::PARAM_STR);
    $updateStmt->bindParam(":id", $userId, PDO::PARAM_INT);
    $updateStmt->execute();
    
    // Return success response
    http_response_code(201);
    echo json_encode([
        "success" => true,
        "message" => "Registration successful",
        "data" => [
            "id" => (int)$userId,
            "username" => $username,
            "email" => $email === "" ? null : $email,
            "contact_number" => null,
            "profile_picture" => null,
            "auth_token" => $authToken,
            "active_status" => 1,
            "created_at" => date("Y-m-d H:i:s"),
            "squads" => []
        ]
    ]);
    
} catch (PDOException $e) {
    error_log("Registration error: " . $e->getMessage());
    http_response_code(500);
    echo json_encode(["success" => false, "message" => "Internal server error"]);
}