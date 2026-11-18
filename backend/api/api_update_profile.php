<?php
/**
 * Konek API - Update Current User Profile Endpoint
 * POST /api/api_update_profile.php
 *
 * Headers: Authorization: Bearer <auth_token>
 * Request Body: { "username": "string", "email": "string|null", "contact_number": "string|null" }
 * Response: { "success": bool, "message": "string", "data": {...} }
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

if (!is_array($input) || !isset($input["username"])) {
    http_response_code(400);
    echo json_encode(["success" => false, "message" => "Username is required"]);
    exit();
}

$username = trim((string) $input["username"]);
$email = isset($input["email"]) ? trim((string) $input["email"]) : "";
$contactNumber = isset($input["contact_number"]) ? trim((string) $input["contact_number"]) : "";

// Validation
if ($username === "") {
    http_response_code(400);
    echo json_encode(["success" => false, "message" => "Username is required"]);
    exit();
}

if (strlen($username) < 3 || strlen($username) > 50) {
    http_response_code(400);
    echo json_encode(["success" => false, "message" => "Username must be between 3 and 50 characters"]);
    exit();
}

if (!preg_match("/^[a-zA-Z0-9_]+$/", $username)) {
    http_response_code(400);
    echo json_encode(["success" => false, "message" => "Username can only contain letters, numbers, and underscores"]);
    exit();
}

if ($email !== "") {
    if (strlen($email) > 255 || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
        http_response_code(400);
        echo json_encode(["success" => false, "message" => "Enter a valid email address"]);
        exit();
    }
}

if ($contactNumber !== "") {
    if (!preg_match("/^\+?[0-9][0-9\s\-()]{6,19}$/", $contactNumber)) {
        http_response_code(400);
        echo json_encode(["success" => false, "message" => "Enter a valid contact number"]);
        exit();
    }
}

try {
    $db = getDBConnection();

    // Identify the caller from the bearer token: users may only edit their own profile.
    $stmt = $db->prepare("SELECT id, username, email FROM users WHERE auth_token = :auth_token AND active_status = 1 LIMIT 1");
    $stmt->bindParam(":auth_token", $authToken, PDO::PARAM_STR);
    $stmt->execute();
    $currentUser = $stmt->fetch();

    if (!$currentUser) {
        http_response_code(401);
        echo json_encode(["success" => false, "message" => "Invalid or expired token"]);
        exit();
    }

    $userId = (int) $currentUser["id"];

    // Username must stay unique across accounts.
    if (strcasecmp($username, $currentUser["username"]) !== 0) {
        $check = $db->prepare("SELECT id FROM users WHERE username = :username AND id <> :id LIMIT 1");
        $check->bindParam(":username", $username, PDO::PARAM_STR);
        $check->bindParam(":id", $userId, PDO::PARAM_INT);
        $check->execute();

        if ($check->fetch()) {
            http_response_code(409);
            echo json_encode(["success" => false, "message" => "Username already taken"]);
            exit();
        }
    }

    // Email must stay unique across accounts (NULL is allowed for multiple users).
    $emailValue = $email === "" ? null : $email;
    if ($emailValue !== null && strcasecmp($emailValue, (string) $currentUser["email"]) !== 0) {
        $check = $db->prepare("SELECT id FROM users WHERE email = :email AND id <> :id LIMIT 1");
        $check->bindParam(":email", $emailValue, PDO::PARAM_STR);
        $check->bindParam(":id", $userId, PDO::PARAM_INT);
        $check->execute();

        if ($check->fetch()) {
            http_response_code(409);
            echo json_encode(["success" => false, "message" => "Email is already used by another account"]);
            exit();
        }
    }

    $contactValue = $contactNumber === "" ? null : $contactNumber;

    $update = $db->prepare("
        UPDATE users
        SET username = :username, email = :email, contact_number = :contact_number
        WHERE id = :id
    ");
    $update->bindParam(":username", $username, PDO::PARAM_STR);
    $update->bindValue(":email", $emailValue, $emailValue === null ? PDO::PARAM_NULL : PDO::PARAM_STR);
    $update->bindValue(":contact_number", $contactValue, $contactValue === null ? PDO::PARAM_NULL : PDO::PARAM_STR);
    $update->bindParam(":id", $userId, PDO::PARAM_INT);
    $update->execute();

    $fetch = $db->prepare("
        SELECT id, username, email, contact_number, profile_picture, active_status, password_set, created_at
        FROM users
        WHERE id = :id
        LIMIT 1
    ");
    $fetch->bindParam(":id", $userId, PDO::PARAM_INT);
    $fetch->execute();
    $user = $fetch->fetch();

    http_response_code(200);
    echo json_encode([
        "success" => true,
        "message" => "Profile updated successfully",
        "data" => [
            "id" => (int) $user["id"],
            "username" => $user["username"],
            "email" => $user["email"],
            "contact_number" => $user["contact_number"],
            "profile_picture" => $user["profile_picture"],
            "active_status" => (int) $user["active_status"],
            "password_set" => (int) $user["password_set"],
            "created_at" => $user["created_at"],
            "auth_token" => $authToken,
        ],
    ]);
} catch (PDOException $e) {
    // Duplicate username/email raced past the pre-checks.
    if ($e->getCode() === "23000") {
        http_response_code(409);
        echo json_encode(["success" => false, "message" => "Username or email is already taken"]);
        exit();
    }
    error_log("Update profile error: " . $e->getMessage());
    http_response_code(500);
    echo json_encode(["success" => false, "message" => "Internal server error"]);
}
