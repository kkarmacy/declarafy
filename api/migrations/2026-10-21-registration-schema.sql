-- Declarafy: reparación aditiva de esquema para instalaciones MySQL/MariaDB existentes.
-- Ejecutar en phpMyAdmin sobre la base correcta después de exportar un respaldo.
-- No elimina usuarios ni datos. Revisar primero que la tabla users tenga id, name, email y password_hash.

ALTER TABLE users ADD COLUMN IF NOT EXISTS public_id CHAR(36) NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS plan ENUM('basico','pro','empresa') NOT NULL DEFAULT 'basico';
ALTER TABLE users ADD COLUMN IF NOT EXISTS message_count INT UNSIGNED NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS onboarded TINYINT(1) NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS tour_done TINYINT(1) NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS regimen VARCHAR(80) NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS sector VARCHAR(120) NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS ruc VARCHAR(11) NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS ref_by VARCHAR(80) NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP;

-- Asignar un ID público a las cuentas antiguas antes de exigirlo.
UPDATE users SET public_id = UUID() WHERE public_id IS NULL OR public_id = '';
ALTER TABLE users MODIFY COLUMN public_id CHAR(36) NOT NULL;

-- Agregar el índice único solo si todavía no existe.
SET @has_public_id_index = (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND INDEX_NAME = 'uq_users_public_id'
);
SET @sql_public_id_index = IF(
  @has_public_id_index = 0,
  'ALTER TABLE users ADD UNIQUE KEY uq_users_public_id (public_id)',
  'SELECT 1'
);
PREPARE stmt_public_id_index FROM @sql_public_id_index;
EXECUTE stmt_public_id_index;
DEALLOCATE PREPARE stmt_public_id_index;

CREATE TABLE IF NOT EXISTS rate_limits (
  identity_hash CHAR(64) NOT NULL,
  action_name VARCHAR(40) NOT NULL,
  bucket_id BIGINT NOT NULL,
  attempts INT UNSIGNED NOT NULL DEFAULT 1,
  PRIMARY KEY (identity_hash, action_name, bucket_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
