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
require_once __DIR__ . "/../lib/mailer.php";



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
$termsAccepted = isset($input["terms_accepted"]) && $input["terms_accepted"] === true;

// Validation
if (empty($username) || empty($password)) {
    http_response_code(400);
    echo json_encode(["success" => false, "message" => "Username and password cannot be empty"]);
    exit();
}

// Consent is required on the server too, not just in the form.
if (!$termsAccepted) {
    http_response_code(400);
    echo json_encode([
        "success" => false,
        "message" => "You must accept the Terms of Service and Privacy Policy to create an account",
    ]);
    exit();
}

if (strlen($username) < 3) {
    http_response_code(400);
    echo json_encode(["success" => false, "message" => "Username must be at least 3 characters"]);
    exit();
}

if ($email === "") {
    http_response_code(400);
    echo json_encode(["success" => false, "message" => "Email is required"]);
    exit();
}

if (strlen($email) > 255 || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
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
    $emailStmt = $db->prepare("SELECT id FROM users WHERE email = :email LIMIT 1");
    $emailStmt->bindParam(":email", $email, PDO::PARAM_STR);
    $emailStmt->execute();

    if ($emailStmt->fetch()) {
        http_response_code(409);
        echo json_encode(["success" => false, "message" => "Email is already registered"]);
        exit();
    }

    // Hash password
    $passwordHash = password_hash($password, PASSWORD_ARGON2ID);

    // Insert new user
    $insertStmt = $db->prepare("INSERT INTO users (username, email, password_hash, active_status, terms_accepted_at) VALUES (:username, :email, :password_hash, 1, NOW())");
    $insertStmt->bindParam(":username", $username, PDO::PARAM_STR);
    $insertStmt->bindParam(":email", $email, PDO::PARAM_STR);
    $insertStmt->bindParam(":password_hash", $passwordHash, PDO::PARAM_STR);
    $insertStmt->execute();
    
    $userId = $db->lastInsertId();
    
    // Generate auth token for auto-login
    $authToken = bin2hex(random_bytes(32));
    $updateStmt = $db->prepare("UPDATE users SET auth_token = :auth_token WHERE id = :id");
    $updateStmt->bindParam(":auth_token", $authToken, PDO::PARAM_STR);
    $updateStmt->bindParam(":id", $userId, PDO::PARAM_INT);
    $updateStmt->execute();

    // The inbox notification is part of the account welcome. It is best-effort
    // so a missing notifications migration never breaks registration.
    try {
        $notifStmt = $db->prepare("
            INSERT INTO notifications (user_id, type, title, message)
            VALUES (:user_id, 'welcome', :title, :message)
        ");
        $notifTitle = "Welcome to Konek, " . $username . "!";
        $notifMessage = "Your account is ready. Create or join a circle to start sharing your location with the people you trust.";
        $notifStmt->bindParam(":user_id", $userId, PDO::PARAM_INT);
        $notifStmt->bindParam(":title", $notifTitle, PDO::PARAM_STR);
        $notifStmt->bindParam(":message", $notifMessage, PDO::PARAM_STR);
        $notifStmt->execute();
    } catch (Throwable $e) {
        error_log("Welcome notification error: " . $e->getMessage());
    }

    // The account exists at this point; a mail failure must never undo it.
    $emailSent = false;
    try {
        $emailSent = konekSendWelcomeEmail($email, $username);
    } catch (Throwable $e) {
        error_log("Welcome email error: " . $e->getMessage());
    }

    // Read the timestamp back so registration matches login/profile responses
    // even when PHP and MySQL use different time zones.
    $createdStmt = $db->prepare("SELECT created_at FROM users WHERE id = :id LIMIT 1");
    $createdStmt->bindParam(":id", $userId, PDO::PARAM_INT);
    $createdStmt->execute();
    $createdAt = $createdStmt->fetchColumn() ?: date("Y-m-d H:i:s");

    // Return success response
    http_response_code(201);
    echo json_encode([
        "success" => true,
        "message" => "Registration successful",
        "email_sent" => $emailSent,
        "data" => [
            "id" => (int)$userId,
            "username" => $username,
            "email" => $email,
            "contact_number" => null,
            "profile_picture" => null,
            "auth_token" => $authToken,
            "active_status" => 1,
            "password_set" => 1,
            "created_at" => $createdAt,
            "squads" => []
        ]
    ]);
    
} catch (PDOException $e) {
    error_log("Registration error: " . $e->getMessage());
    http_response_code(500);
    echo json_encode(["success" => false, "message" => "Internal server error"]);
}