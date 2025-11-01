export function projectBase(projectId: string) { return `/projects/${projectId}` }
export function projectDashboard(projectId: string) { return `${projectBase(projectId)}/dashboard` }
export function projectContext(projectId: string) { return `${projectBase(projectId)}/context` }
export function projectDailyPosts(projectId: string) { return `${projectBase(projectId)}/daily-posts` }
export function projectMyContent(projectId: string) { return `${projectBase(projectId)}/my-content` }
export function projectSchedule(projectId: string) { return `${projectBase(projectId)}/schedule` }
export function projectSettings(projectId: string) { return `${projectBase(projectId)}/settings` }


