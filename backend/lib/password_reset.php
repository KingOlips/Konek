<?php
/**
 * Shared password-reset verification logic.
 *
 * The email link carries the raw reset token. Opening it proves the recipient
 * owns the mailbox, so this helper:
 *   1. confirms the token exists, has not expired, and belongs to an active user
 *   2. marks the matching cross-device session as verified
 *   3. issues the one-time token the requesting screen polls for
 *
 * It is used by both the HTML landing page (reset_verify.php) and the JSON
 * endpoint the native app calls when an App Link opens the app directly.
 */

/**
 * @return array{valid: bool, message: string}
 */
function konekVerifyResetToken(PDO $db, string $rawToken): array
{
    $rawToken = trim($rawToken);
    if (preg_match("/^[a-f0-9]{64}$/i", $rawToken) !== 1) {
        return [
            "valid" => false,
            "message" => "This verification link is incomplete or invalid.",
        ];
    }

    $tokenHash = hash("sha256", $rawToken);

    try {
        $db->beginTransaction();

        $stmt = $db->prepare("
            SELECT pr.id AS reset_id, pr.user_id, pr.session_id
            FROM password_resets pr
            INNER JOIN users u ON u.id = pr.user_id
            WHERE pr.token_hash = :token_hash
              AND pr.expires_at > NOW()
              AND u.active_status = 1
            LIMIT 1
            FOR UPDATE
        ");
        $stmt->bindParam(":token_hash", $tokenHash, PDO::PARAM_STR);
        $stmt->execute();
        $reset = $stmt->fetch();

        if (!$reset) {
            $db->rollBack();
            return [
                "valid" => false,
                "message" => "This verification link is invalid or has expired. Request a new password reset.",
            ];
        }

        if (!empty($reset["session_id"])) {
            // Keep the token stable if the link is opened twice, so a screen
            // that already received it can still complete the reset.
            $desktopToken = bin2hex(random_bytes(32));
            $sessionStmt = $db->prepare("
                UPDATE password_reset_sessions
                SET status = 'verified',
                    desktop_token = COALESCE(desktop_token, :desktop_token)
                WHERE id = :session_id
                  AND expires_at > NOW()
            ");
            $sessionStmt->bindParam(":desktop_token", $desktopToken, PDO::PARAM_STR);
            $sessionStmt->bindParam(":session_id", $reset["session_id"], PDO::PARAM_STR);
            $sessionStmt->execute();
        }

        $db->commit();

        return ["valid" => true, "message" => "Email verified"];
    } catch (PDOException $e) {
        if ($db->inTransaction()) {
            $db->rollBack();
        }
        error_log("Verify reset token error: " . $e->getMessage());
        return [
            "valid" => false,
            "message" => "We couldn't verify this link right now. Please try again.",
        ];
    }
}
