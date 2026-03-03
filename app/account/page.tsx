import { PasswordForm } from '@/components/features/account/password-form';
import { ProfileNameForm } from '@/components/features/account/profile-name-form';
import { Separator } from '@/components/ui/separator';
import { getProfileDataAction } from '@/lib/actions/account';

export default async function AccountPage() {
  const profile = await getProfileDataAction();

  return (
    <div className="space-y-8">
      <div className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Profile</h2>
          <p className="text-muted-foreground text-sm">Update your display name.</p>
        </div>
        <div className="rounded-lg border p-4">
          <ProfileNameForm initialName={profile.name} />
        </div>
      </div>

      <Separator />

      <div className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Password</h2>
          <p className="text-muted-foreground text-sm">
            {profile.hasPassword
              ? 'Change your account password.'
              : 'Set a password to enable email/password login.'}
          </p>
        </div>
        <div className="rounded-lg border p-4">
          <PasswordForm hasPassword={profile.hasPassword} />
        </div>
      </div>
    </div>
  );
}
