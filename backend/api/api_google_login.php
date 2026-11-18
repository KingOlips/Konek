<?php
/**
 * Konek API - Google Sign-In Endpoint
 * POST /api/api_google_login.php
 *
 * Headers: none required
 * Request Body: { "id_token": "string" }
 * Response: { "success": bool, "data": {...}, "message": "string" }
 *
 * Flow:
 *   1. Verify the Google ID token with Google's tokeninfo endpoint.
 *   2. Confirm the audience belongs to this app and the email is verified.
 *   3. Existing account -> sign in. Existing email -> link Google, sign in.
 *   4. Brand-new Google user -> return action_required "complete_profile"
 *      plus a short-lived signed token. The account is only created once the
 *      user picks a username and a password in the app (see
 *      api_complete_google_profile.php).
 */

require_once __DIR__ . "/../config/database.php";
require_once __DIR__ . "/../config/cors.php";
require_once __DIR__ . "/../config/google.php";

const KONEK_GOOGLE_PROFILE_TOKEN_TTL = 600; // 10 minutes

// Only allow POST requests
if ($_SERVER["REQUEST_METHOD"] !== "POST") {
    http_response_code(405);
    echo json_encode(["success" => false, "message" => "Method not allowed"]);
    exit();
}

// Get JSON input
$input = json_decode(file_get_contents("php://input"), true);

if (!$input || !isset($input["id_token"]) || !is_string($input["id_token"])) {
    http_response_code(400);
    echo json_encode(["success" => false, "message" => "id_token is required"]);
    exit();
}

$idToken = trim($input["id_token"]);

if ($idToken === "") {
    http_response_code(400);
    echo json_encode(["success" => false, "message" => "id_token is required"]);
    exit();
}

/**
 * Fetch the token claims from Google. Using tokeninfo means Google checks the
 * signature, issuer, and expiry for us; we still verify the audience and email
 * below because those checks are application-specific.
 */
function fetchGoogleTokenInfo(string $idToken): ?array {
    $url = "https://oauth2.googleapis.com/tokeninfo?id_token=" . rawurlencode($idToken);

    if (function_exists("curl_init")) {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => 10,
            CURLOPT_CONNECTTIMEOUT => 5,
        ]);
        $body = curl_exec($ch);
        $status = curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        curl_close($ch);

        if ($body === false || $status !== 200) {
            return null;
        }
    } else {
        $context = stream_context_create([
            "http" => ["timeout" => 10, "ignore_errors" => true],
        ]);
        $body = @file_get_contents($url, false, $context);
        if ($body === false) {
            return null;
        }
    }

    $claims = json_decode($body, true);
    return is_array($claims) ? $claims : null;
}

/**
 * Turn a display name or email into a suggested username. This is only a
 * starting point for the "complete profile" form; the user may change it.
 */
function suggestUsername(string $email, string $displayName): string {
    $localPart = strstr($email, "@", true);
    $source = $localPart !== false && $localPart !== "" ? $localPart : $displayName;
    $base = preg_replace("/[^a-zA-Z0-9_]/", "", $source);
    $base = substr($base, 0, 40);

    if (strlen($base) < 3) {
        $base = "user" . $base;
    }

    return $base;
}

/** base64url without padding. */
function base64UrlEncode(string $value): string {
    return rtrim(strtr(base64_encode($value), "+/", "-_"), "=");
}

/** Signed, stateless token carrying a verified Google identity. */
function createProfileToken(string $googleId, string $email, string $displayName, string $suggestedUsername): string {
    $payload = json_encode([
        "gid" => $googleId,
        "email" => $email,
        "name" => $displayName,
        "user" => $suggestedUsername,
        "exp" => time() + KONEK_GOOGLE_PROFILE_TOKEN_TTL,
    ]);

    $encoded = base64UrlEncode($payload);
    $signature = hash_hmac("sha256", $encoded, KONEK_GOOGLE_SIGNUP_SECRET, true);

    return $encoded . "." . base64UrlEncode($signature);
}

/** Session payload shared with api_login.php. */
function buildSessionPayload(array $user, string $authToken, array $squads): array {
    return [
        "id" => (int) $user["id"],
        "username" => $user["username"],
        "email" => $user["email"],
        "contact_number" => $user["contact_number"],
        "profile_picture" => $user["profile_picture"],
        "auth_token" => $authToken,
        "active_status" => (int) $user["active_status"],
        "password_set" => (int) ($user["password_set"] ?? 1),
        "created_at" => $user["created_at"],
        "squads" => $squads,
    ];
}

try {
    $claims = fetchGoogleTokenInfo($idToken);

    if ($claims === null) {
        http_response_code(401);
        echo json_encode(["success" => false, "message" => "Google token is invalid or expired"]);
        exit();
    }

    $audience = isset($claims["aud"]) ? (string) $claims["aud"] : "";
    if (!in_array($audience, KONEK_GOOGLE_CLIENT_IDS, true)) {
        http_response_code(401);
        echo json_encode(["success" => false, "message" => "Google token was issued for a different app"]);
        exit();
    }

    $email = isset($claims["email"]) ? trim((string) $claims["email"]) : "";
    $emailVerified = isset($claims["email_verified"]) && (string) $claims["email_verified"] === "true";
    $googleId = isset($claims["sub"]) ? trim((string) $claims["sub"]) : "";
    $displayName = isset($claims["name"]) ? trim((string) $claims["name"]) : "";

    if ($email === "" || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
        http_response_code(400);
        echo json_encode(["success" => false, "message" => "Google account has no usable email address"]);
        exit();
    }

    if (!$emailVerified) {
        http_response_code(403);
        echo json_encode(["success" => false, "message" => "Google email is not verified"]);
        exit();
    }

    if ($googleId === "") {
        http_response_code(401);
        echo json_encode(["success" => false, "message" => "Google token is missing an account identifier"]);
        exit();
    }

    $db = getDBConnection();

    // 1. Returning Google user: match on the stable Google subject id.
    $userStmt = $db->prepare("
        SELECT id, username, email, contact_number, profile_picture, active_status, password_set, created_at
        FROM users
        WHERE google_id = :google_id
        LIMIT 1
    ");
    $userStmt->bindParam(":google_id", $googleId, PDO::PARAM_STR);
    $userStmt->execute();
    $user = $userStmt->fetch(PDO::FETCH_ASSOC);

    // 2. Existing password account with the same (verified) email: link it.
    if (!$user) {
        $emailStmt = $db->prepare("
            SELECT id, username, email, contact_number, profile_picture, active_status, password_set, created_at, google_id
            FROM users
            WHERE email = :email
            LIMIT 1
        ");
        $emailStmt->bindParam(":email", $email, PDO::PARAM_STR);
        $emailStmt->execute();
        $existing = $emailStmt->fetch(PDO::FETCH_ASSOC);

        if ($existing) {
            $existingGoogleId = (string) ($existing["google_id"] ?? "");
            if ($existingGoogleId !== "" && $existingGoogleId !== $googleId) {
                http_response_code(409);
                echo json_encode([
                    "success" => false,
                    "message" => "This email is already linked to a different Google account",
                ]);
                exit();
            }

            $linkStmt = $db->prepare("UPDATE users SET google_id = :google_id WHERE id = :id");
            $linkStmt->bindParam(":google_id", $googleId, PDO::PARAM_STR);
            $linkStmt->bindParam(":id", $existing["id"], PDO::PARAM_INT);
            $linkStmt->execute();

            unset($existing["google_id"]);
            $user = $existing;
        }
    }

    // 3. Brand-new Google user: defer account creation until the profile form
    //    (username + password) is completed.
    if (!$user) {
        http_response_code(200);
        echo json_encode([
            "success" => true,
            "message" => "Choose your Konek username and password to finish signing up",
            "action_required" => "complete_profile",
            "temp_token" => createProfileToken(
                $googleId,
                $email,
                $displayName,
                suggestUsername($email, $displayName)
            ),
            "email" => $email,
            "suggested_username" => suggestUsername($email, $displayName),
        ]);
        exit();
    }

    if (!$user["active_status"]) {
        http_response_code(403);
        echo json_encode(["success" => false, "message" => "Account is deactivated"]);
        exit();
    }

    // Issue a fresh opaque token, exactly like a password login.
    $authToken = bin2hex(random_bytes(32));
    $updateStmt = $db->prepare("UPDATE users SET auth_token = :auth_token WHERE id = :id");
    $updateStmt->bindParam(":auth_token", $authToken, PDO::PARAM_STR);
    $updateStmt->bindParam(":id", $user["id"], PDO::PARAM_INT);
    $updateStmt->execute();

    $squadStmt = $db->prepare("
        SELECT s.id, s.squad_name, s.join_code, sm.role
        FROM squads s
        INNER JOIN squad_members sm ON s.id = sm.squad_id
        WHERE sm.user_id = :user_id
    ");
    $squadStmt->bindParam(":user_id", $user["id"], PDO::PARAM_INT);
    $squadStmt->execute();
    $squads = $squadStmt->fetchAll(PDO::FETCH_ASSOC);

    http_response_code(200);
    echo json_encode([
        "success" => true,
        "message" => "Login successful",
        "data" => buildSessionPayload($user, $authToken, $squads),
    ]);

} catch (PDOException $e) {
    error_log("Google login error: " . $e->getMessage());
    http_response_code(500);
    if (
        (strpos($e->getMessage(), "password_set") !== false || strpos($e->getMessage(), "google_id") !== false)
        && strpos($e->getMessage(), "Unknown column") !== false
    ) {
        echo json_encode([
            "success" => false,
            "message" => "Google sign-in is not enabled yet. Run the google_id and password_set migrations from database/migrations",
        ]);
        exit();
    }
    echo json_encode(["success" => false, "message" => "Internal server error"]);
} catch (Exception $e) {
    error_log("Google login error: " . $e->getMessage());
    http_response_code(500);
    echo json_encode(["success" => false, "message" => "Internal server error"]);
}
