-- Give each circle membership an optional family/friend label without
-- touching the permission role (`member` / `admin`).
ALTER TABLE `squad_members`
    ADD COLUMN `relationship` ENUM(
        'dad',
        'mom',
        'son',
        'daughter',
        'child',
        'grandparent',
        'partner',
        'friend',
        'other'
    ) NULL DEFAULT NULL AFTER `role`;
