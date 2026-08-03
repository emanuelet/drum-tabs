export type UserRole = "teacher" | "learner";

export type SessionUser = { id: string; [key: string]: unknown };

export interface AuthPort {
    handle(request: Request): Promise<Response> | Response;
    getSession(request: Request): Promise<{ user: SessionUser } | null>;
    signUpEmail(input: { email: string; name: string; password: string }): Promise<{ user: SessionUser; [key: string]: unknown }>;
    isSignUpDisabled(): boolean;
    isSetupComplete(): Promise<boolean>;
}

export interface IdentityPort {
    getRole(userId: string): Promise<UserRole>;
    setRole(userId: string, role: UserRole): Promise<void>;
}

export interface IdentityRouteDependencies {
    auth: AuthPort;
    identity: IdentityPort;
}

export interface Learner {
    id: string;
    name: string;
    email: string;
}

export interface Assignment {
    id: string;
    teacherId: string;
    teacherName: string;
    learnerId: string;
    resourceType: "exercise" | "tab";
    resourceId: string;
    createdAt: string;
}

export interface TeachingPort {
    searchLearners(query: string): Promise<Learner[]>;
    listStudents(teacherId: string): Promise<{ students: Learner[]; assignments: Assignment[] }>;
    connectStudent(teacherId: string, learnerId: string): Promise<void>;
    disconnectStudent(teacherId: string, learnerId: string): Promise<void>;
    createAssignment(teacherId: string, learnerId: string, resourceType: "exercise" | "tab", resourceId: string): Promise<string>;
    deleteAssignment(teacherId: string, assignmentId: string): Promise<void>;
    listAssignments(userId: string, role: UserRole): Promise<Assignment[]>;
}

export interface ResourcePort {
    hasExercise(id: string): Promise<boolean>;
    hasTab(id: string): Promise<boolean>;
}

export interface TeachingRouteDependencies extends IdentityRouteDependencies {
    teaching: TeachingPort;
    resources: ResourcePort;
}

export interface Exercise {
    id: string;
    title: string;
    subtitle: string;
    tempo: number;
    alphaTex: string;
    fav: boolean;
    createdAt: string;
}

export interface ExercisePort {
    list(): Promise<Exercise[]>;
    create(input: Omit<Exercise, "id" | "fav" | "createdAt">): Promise<Exercise>;
    update(id: string, input: Pick<Exercise, "title" | "subtitle" | "tempo" | "alphaTex">): Promise<Exercise>;
    setFavorite(id: string, fav: boolean): Promise<Exercise>;
    delete(id: string): Promise<void>;
}

export interface ExerciseRouteDependencies extends IdentityRouteDependencies {
    exercises: ExercisePort;
}

export interface TabSummary {
    id: string;
    title: string;
    artist: string;
    filename: string;
    originalFilename: string;
    createdAt: string;
    public: boolean;
    fav: boolean;
}

export interface TabListPort {
    list(): Promise<TabSummary[]>;
}

export interface TabListRouteDependencies extends TeachingRouteDependencies {
    tabs: TabListPort;
}

export interface SettingsPort {
    get(userId: string): Promise<unknown | undefined>;
    set(userId: string, value: unknown): Promise<void>;
}

export interface SettingsRouteDependencies extends IdentityRouteDependencies {
    settings: SettingsPort;
}

export interface TabDetailPort {
    get(id: string): Promise<{ tab: TabSummary; audioList: unknown[]; youtubeList: unknown[] }>;
    showOpenButtons: boolean;
    getLocalPath?(id: string): Promise<string>;
}

export interface TabDetailRouteDependencies extends IdentityRouteDependencies {
    tabDetail: TabDetailPort;
}

export interface TabMutationPort {
    update(id: string, input: Pick<TabSummary, "title" | "artist" | "public">): Promise<void>;
    setFavorite(id: string, fav: boolean): Promise<void>;
}

export interface TabMutationRouteDependencies extends IdentityRouteDependencies {
    tabMutations: TabMutationPort;
}
