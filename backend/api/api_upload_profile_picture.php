<?php
/**
 * Konek API - Upload Profile Picture Endpoint
 * POST /api/api_upload_profile_picture.php  (multipart/form-data)
 *
 * Headers: Authorization: Bearer <auth_token>
 * Form field: profile_picture (JPG, JPEG, PNG or WEBP, max 5 MB)
 * Response: { "success": bool, "message": "string", "data": {...} }
 */

require_once __DIR__ . "/../config/database.php";
require_once __DIR__ . "/../config/cors.php";

const MAX_PROFILE_PICTURE_BYTES = 5 * 1024 * 1024; // 5 MB

/**
 * Allowed image types: detected MIME => canonical file extension.
 * Everything else (including SVG, GIF, and any non-image file) is rejected.
 */
function allowedProfilePictureTypes(): array {
    return [
        "image/jpeg" => "jpg",
        "image/png" => "png",
        "image/webp" => "webp",
    ];
}

/**
 * Absolute path to the profile picture upload directory, creating it if needed.
 */
function profilePictureDirectory(): string {
    $dir = __DIR__ . "/../uploads/profile_pictures";
    if (!is_dir($dir) && !mkdir($dir, 0755, true) && !is_dir($dir)) {
        throw new RuntimeException("Upload directory could not be created");
    }
    return $dir;
}

// Only allow POST requests
if ($_SERVER["REQUEST_METHOD"] !== "POST") {
    http_response_code(405);
    echo json_encode(["success" => false, "message" => "Method not allowed"]);
    exit();
}

// Get auth token from the Authorization header (Apache may strip/rename it)
$authToken = requireBearerToken();

if (!isset($_FILES["profile_picture"])) {
    http_response_code(400);
    echo json_encode(["success" => false, "message" => "No picture was uploaded"]);
    exit();
}

$file = $_FILES["profile_picture"];

if (!is_array($file) || !isset($file["error"])) {
    http_response_code(400);
    echo json_encode(["success" => false, "message" => "Invalid upload"]);
    exit();
}

switch ($file["error"]) {
    case UPLOAD_ERR_OK:
        break;
    case UPLOAD_ERR_INI_SIZE:
    case UPLOAD_ERR_FORM_SIZE:
        http_response_code(400);
        echo json_encode(["success" => false, "message" => "Picture is too large. Maximum size is 5 MB"]);
        exit();
    case UPLOAD_ERR_NO_FILE:
        http_response_code(400);
        echo json_encode(["success" => false, "message" => "No picture was uploaded"]);
        exit();
    default:
        http_response_code(400);
        echo json_encode(["success" => false, "message" => "Upload failed. Please try again"]);
        exit();
}

if (!is_uploaded_file($file["tmp_name"])) {
    http_response_code(400);
    echo json_encode(["success" => false, "message" => "Invalid upload"]);
    exit();
}

if ((int) $file["size"] <= 0 || (int) $file["size"] > MAX_PROFILE_PICTURE_BYTES) {
    http_response_code(400);
    echo json_encode(["success" => false, "message" => "Picture is too large. Maximum size is 5 MB"]);
    exit();
}

// Inspect the actual image bytes instead of trusting the client-provided type.
$imageInfo = @getimagesize($file["tmp_name"]);
$allowedTypes = allowedProfilePictureTypes();

if ($imageInfo === false || !isset($imageInfo["mime"]) || !isset($allowedTypes[$imageInfo["mime"]])) {
    http_response_code(400);
    echo json_encode(["success" => false, "message" => "Only JPG, JPEG, PNG, and WEBP images are allowed"]);
    exit();
}

$extension = $allowedTypes[$imageInfo["mime"]];

try {
    $db = getDBConnection();

    // Identify the caller from the bearer token: users may only change their own picture.
    $stmt = $db->prepare("SELECT id, profile_picture FROM users WHERE auth_token = :auth_token AND active_status = 1 LIMIT 1");
    $stmt->bindParam(":auth_token", $authToken, PDO::PARAM_STR);
    $stmt->execute();
    $currentUser = $stmt->fetch();

    if (!$currentUser) {
        http_response_code(401);
        echo json_encode(["success" => false, "message" => "Invalid or expired token"]);
        exit();
    }

    $userId = (int) $currentUser["id"];

    // Store under a random, server-generated name (never the user's filename).
    $fileName = bin2hex(random_bytes(16)) . "." . $extension;
    $uploadDir = profilePictureDirectory();
    $destination = $uploadDir . DIRECTORY_SEPARATOR . $fileName;

    if (!move_uploaded_file($file["tmp_name"], $destination)) {
        http_response_code(500);
        echo json_encode(["success" => false, "message" => "Failed to save the uploaded picture"]);
        exit();
    }

    $relativePath = "uploads/profile_pictures/" . $fileName;

    $update = $db->prepare("UPDATE users SET profile_picture = :profile_picture WHERE id = :id");
    $update->bindParam(":profile_picture", $relativePath, PDO::PARAM_STR);
    $update->bindParam(":id", $userId, PDO::PARAM_INT);
    $update->execute();

    // Remove the previous picture once the new one is safely stored.
    $oldRelativePath = (string) $currentUser["profile_picture"];
    if ($oldRelativePath !== "" && strpos($oldRelativePath, "uploads/profile_pictures/") === 0) {
        $oldFile = realpath($uploadDir . DIRECTORY_SEPARATOR . basename($oldRelativePath));
        $uploadDirReal = realpath($uploadDir);
        if (
            $oldFile !== false
            && $uploadDirReal !== false
            && strpos($oldFile, $uploadDirReal . DIRECTORY_SEPARATOR) === 0
            && is_file($oldFile)
        ) {
            @unlink($oldFile);
        }
    }

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
        "message" => "Profile picture updated successfully",
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
    error_log("Upload profile picture error: " . $e->getMessage());
    http_response_code(500);
    echo json_encode(["success" => false, "message" => "Internal server error"]);
} catch (RuntimeException $e) {
    error_log("Upload profile picture error: " . $e->getMessage());
    http_response_code(500);
    echo json_encode(["success" => false, "message" => "Failed to save the uploaded picture"]);
}
