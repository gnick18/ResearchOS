import { useFileSystem } from "../lib/file-system/file-system-context";

export function useCurrentUser() {
  const { currentUser, setCurrentUser, mainUser, availableUsers, createUser } = useFileSystem();
  
  return {
    currentUser,
    setCurrentUser,
    mainUser,
    availableUsers,
    createUser,
    isLoggedIn: currentUser !== null,
  };
}
