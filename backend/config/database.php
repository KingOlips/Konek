<?php
/**
 * Konek Database Configuration
 * XAMPP MySQL connection using PDO
 */

function getDBConnection(): PDO {
    // XAMPP default MySQL settings
    $host = "localhost";
    $dbname = "konek_db";
    $username = "root";
    $password = ""; // XAMPP default has no password for root
    $charset = "utf8mb4";
    
    $dsn = "mysql:host=$host;dbname=$dbname;charset=$charset";
    
    $options = [
        PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES   => false,
        PDO::MYSQL_ATTR_INIT_COMMAND => "SET NAMES $charset",
    ];
    
    try {
        $pdo = new PDO($dsn, $username, $password, $options);
        return $pdo;
    } catch (PDOException $e) {
        error_log("Database connection failed: " . $e->getMessage());
        throw new Exception("Database connection failed");
    }
}
/**
 * Read the Authorization header from every place Apache/PHP may expose it.
 * Some XAMPP setups drop the header or move it to REDIRECT_HTTP_AUTHORIZATION.
 */
function getAuthorizationHeader(): string {
    $candidates = [
        $_SERVER["HTTP_AUTHORIZATION"] ?? "",
        $_SERVER["REDIRECT_HTTP_AUTHORIZATION"] ?? "",
        $_SERVER["HTTP_X_AUTHORIZATION"] ?? "",
    ];

    if (function_exists("apache_request_headers")) {
        foreach (apache_request_headers() as $name => $value) {
            if (strcasecmp($name, "Authorization") === 0) {
                $candidates[] = $value;
            }
        }
    }

    foreach ($candidates as $header) {
        if (!empty($header)) {
            return trim($header);
        }
    }
    return "";
}

/**
 * Return the bearer token or terminate with a 401 JSON response.
 */
function requireBearerToken(): string {
    $header = getAuthorizationHeader();
    if (!preg_match('/^Bearer\s+(.+)$/i', $header, $matches)) {
        http_response_code(401);
        echo json_encode(["success" => false, "message" => "Authorization token required"]);
        exit();
    }
    return trim($matches[1]);
}