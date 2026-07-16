// Read-side queries for the self-service profile screen.

import { requireUser } from "@/lib/permissions";

import { getAvatarUrl } from "./avatar";

export interface MyProfile {
  id: string;
  name: string;
  username: string;
  email: string;
  bio: string | null;
  avatarUrl: string | null;
}

/** The signed-in user's own profile, with a resolved (presigned) avatar URL. */
export async function getMyProfile(): Promise<MyProfile> {
  const user = await requireUser();
  const avatarUrl = await getAvatarUrl(user.avatarKey);

  return {
    id: user.id,
    name: user.name,
    username: user.username,
    email: user.email,
    bio: user.bio,
    avatarUrl,
  };
}
