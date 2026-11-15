/** The screens of the main window. One is shown at a time. */
export type Route =
  | { name: "home" }
  | { name: "topic"; topicId: string }
  | { name: "note"; noteId: string; topicId: string }
  | { name: "questions"; topicId: string }
  | { name: "practice"; title: string; topicIds?: string[] }
  | { name: "suggestions" }
  | { name: "progress" }
  | { name: "settings" };

export type Go = (route: Route) => void;
