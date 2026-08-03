PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS user_role (
    user_id TEXT PRIMARY KEY REFERENCES user(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('teacher', 'learner'))
);

-- Existing installations had a single administrator before roles were added.
INSERT OR IGNORE INTO user_role (user_id, role)
SELECT id, 'teacher' FROM user;

CREATE TABLE IF NOT EXISTS teacher_student (
    teacher_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
    learner_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    PRIMARY KEY (teacher_id, learner_id)
);

CREATE TABLE IF NOT EXISTS assignment (
    id TEXT PRIMARY KEY,
    teacher_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
    learner_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
    resource_type TEXT NOT NULL CHECK (resource_type IN ('exercise', 'tab')),
    resource_id TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS assignment_learner_idx ON assignment(learner_id);
CREATE INDEX IF NOT EXISTS assignment_teacher_idx ON assignment(teacher_id);
