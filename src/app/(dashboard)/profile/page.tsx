import { AVATAR_ALLOWED_TYPES, AVATAR_MAX_BYTES } from "@/lib/r2";
import { getMyProfile } from "@/features/users/queries";
import { AvatarUploader } from "@/features/users/components/AvatarUploader";
import { ProfileForm } from "@/features/users/components/ProfileForm";

// A settings surface, not the working canvas — glass reads fine here (chrome,
// not a scrolling list of task cards). Server Component: fetches the profile
// (incl. a presigned avatar URL) up front, then hydrates only the two
// interactive pieces (avatar upload, form) as client children.
export default async function ProfilePage() {
  const profile = await getMyProfile();

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">
        Profile
      </h1>

      <div className="glass flex max-w-2xl flex-col gap-8 p-6">
        <AvatarUploader
          name={profile.name}
          avatarUrl={profile.avatarUrl}
          allowedTypes={AVATAR_ALLOWED_TYPES}
          maxBytes={AVATAR_MAX_BYTES}
        />

        <ProfileForm
          defaultValues={{
            name: profile.name,
            username: profile.username,
            bio: profile.bio ?? "",
          }}
        />
      </div>
    </div>
  );
}
