<?php
/**
 * Konek API - Complete a Google Sign-Up
 * POST /api/api_complete_google_profile.php
 *
 * Headers: none required
 * Request Body: {
 *   "temp_token": "string",   // from api_google_login.php
 *   "username": "string",
 *   "password": "string"
 * }
 * Response: { "success": bool, "data": {...}, "message": "string" }
 *
 * The temporary token proves the user verified a Google account. The account
 * is only created here, after the user picks their own Konek username and a
 * password, so every account can sign in with either Google or a password.
 */

require_once __DIR__ . "/../config/database.php";
require_once __DIR__ . "/../config/cors.php";
require_once __DIR__ . "/../config/google.php";

// Only allow POST requests
if ($_SERVER["REQUEST_METHOD"] !== "POST") {
    http_response_code(405);
    echo json_encode(["success" => false, "message" => "Method not allowed"]);
    exit();
}

$input = json_decode(file_get_contents("php://input"), true);

$tempToken = isset($input["temp_token"]) ? trim((string) $input["temp_token"]) : "";
$username = isset($input["username"]) ? trim((string) $input["username"]) : "";
$password = isset($input["password"]) ? (string) $input["password"] : "";
$termsAccepted = isset($input["terms_accepted"]) && $input["terms_accepted"] === true;

if ($tempToken === "" || $username === "" || $password === "") {
    http_response_code(400);
    echo json_encode(["success" => false, "message" => "Username and password are required"]);
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

if (strlen($password) < 6) {
    http_response_code(400);
    echo json_encode(["success" => false, "message" => "Password must be at least 6 characters"]);
    exit();
}

if (strlen($password) > 200) {
    http_response_code(400);
    echo json_encode(["success" => false, "message" => "Password is too long"]);
    exit();
}

/** base64url without padding. */
function base64UrlEncode(string $value): string {
    return rtrim(strtr(base64_encode($value), "+/", "-_"), "=");
}

function base64UrlDecode(string $value): string {
    $padded = strtr($value, "-_", "+/");
    $padded .= str_repeat("=", (4 - strlen($padded) % 4) % 4);
    return base64_decode($padded, true);
}

/** Verify the signed identity token from api_google_login.php. */
function verifyProfileToken(string $token): ?array {
    $parts = explode(".", $token);
    if (count($parts) !== 2) {
        return null;
    }

    [$encoded, $encodedSignature] = $parts;
    $expected = hash_hmac("sha256", $encoded, KONEK_GOOGLE_SIGNUP_SECRET, true);

    if (!hash_equals($expected, base64UrlDecode($encodedSignature))) {
        return null;
    }

    $payload = json_decode(base64UrlDecode($encoded), true);
    if (!is_array($payload)) {
        return null;
    }

    if (!isset($payload["exp"]) || (int) $payload["exp"] < time()) {
        return null;
    }

    if (empty($payload["gid"]) || empty($payload["email"])) {
        return null;
    }

    return $payload;
}

try {
    $claims = verifyProfileToken($tempToken);

    if ($claims === null) {
        http_response_code(401);
        echo json_encode([
            "success" => false,
            "message" => "This sign-up session has expired. Please sign in with Google again.",
        ]);
        exit();
    }

    $googleId = (string) $claims["gid"];
    $email = (string) $claims["email"];

    $db = getDBConnection();

    // The same Google identity or email may have completed the form already
    // (double tap, retry after a lost response). Do not create a duplicate.
    $existsStmt = $db->prepare("
        SELECT id FROM users
        WHERE google_id = :google_id OR email = :email
        LIMIT 1
    ");
    $existsStmt->bindParam(":google_id", $googleId, PDO::PARAM_STR);
    $existsStmt->bindParam(":email", $email, PDO::PARAM_STR);
    $existsStmt->execute();

    if ($existsStmt->fetch()) {
        http_response_code(409);
        echo json_encode([
            "success" => false,
            "message" => "This Google account already has a Konek account. Please sign in again.",
        ]);
        exit();
    }

    $usernameStmt = $db->prepare("SELECT id FROM users WHERE username = :username LIMIT 1");
    $usernameStmt->bindParam(":username", $username, PDO::PARAM_STR);
    $usernameStmt->execute();

    if ($usernameStmt->fetch()) {
        http_response_code(409);
        echo json_encode(["success" => false, "message" => "Username already taken"]);
        exit();
    }

    $passwordHash = password_hash($password, PASSWORD_ARGON2ID);
    $authToken = bin2hex(random_bytes(32));

    $insertStmt = $db->prepare("
        INSERT INTO users (username, email, password_hash, google_id, password_set, auth_token, active_status, terms_accepted_at)
        VALUES (:username, :email, :password_hash, :google_id, 1, :auth_token, 1, NOW())
    ");
    $insertStmt->bindParam(":username", $username, PDO::PARAM_STR);
    $insertStmt->bindParam(":email", $email, PDO::PARAM_STR);
    $insertStmt->bindParam(":password_hash", $passwordHash, PDO::PARAM_STR);
    $insertStmt->bindParam(":google_id", $googleId, PDO::PARAM_STR);
    $insertStmt->bindParam(":auth_token", $authToken, PDO::PARAM_STR);
    $insertStmt->execute();

    $userId = (int) $db->lastInsertId();

    $userStmt = $db->prepare("
        SELECT id, username, email, contact_number, profile_picture, active_status, password_set, created_at
        FROM users
        WHERE id = :id
        LIMIT 1
    ");
    $userStmt->bindParam(":id", $userId, PDO::PARAM_INT);
    $userStmt->execute();
    $user = $userStmt->fetch(PDO::FETCH_ASSOC);

    http_response_code(201);
    echo json_encode([
        "success" => true,
        "message" => "Account created",
        "data" => [
            "id" => (int) $user["id"],
            "username" => $user["username"],
            "email" => $user["email"],
            "contact_number" => $user["contact_number"],
            "profile_picture" => $user["profile_picture"],
            "auth_token" => $authToken,
            "active_status" => (int) $user["active_status"],
            "password_set" => (int) $user["password_set"],
            "created_at" => $user["created_at"],
            "squads" => [],
        ],
    ]);

} catch (PDOException $e) {
    error_log("Complete Google profile error: " . $e->getMessage());
    http_response_code(500);
    if (strpos($e->getMessage(), "password_set") !== false && strpos($e->getMessage(), "Unknown column") !== false) {
        echo json_encode([
            "success" => false,
            "message" => "Google sign-up is not enabled yet. Run the password_set migration from database/migrations",
        ]);
        exit();
    }
    if (strpos($e->getMessage(), "Duplicate entry") !== false) {
        echo json_encode(["success" => false, "message" => "That username or email is already registered"]);
        exit();
    }
    echo json_encode(["success" => false, "message" => "Internal server error"]);
} catch (Exception $e) {
    error_log("Complete Google profile error: " . $e->getMessage());
    http_response_code(500);
    echo json_encode(["success" => false, "message" => "Internal server error"]);
}
