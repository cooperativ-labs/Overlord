'use client';

import { useCallback, useEffect, useState } from 'react';

import { PasswordForm } from '@/components/features/account/password-form';
import { ProfileImageForm } from '@/components/features/account/profile-image-form';
import { ProfileNameForm } from '@/components/features/account/profile-name-form';
import { ProfileUsernameForm } from '@/components/features/account/profile-username-form';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { getProfileDataAction, type ProfileData } from '@/lib/actions/account';

type UserProfilePageProps = {
  open: boolean;
};

export function UserProfilePage({ open }: UserProfilePageProps) {
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const loadProfile = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);

    try {
      const loaded = await getProfileDataAction();
      setProfile(loaded);
    } catch (error) {
      console.error('Failed to load profile settings:', error);
      setErrorMessage(error instanceof Error ? error.message : 'Failed to load profile settings.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) {
      setErrorMessage(null);
      return;
    }

    void loadProfile();
  }, [open, loadProfile]);

  if (isLoading && !profile) {
    return <p className="text-sm text-muted-foreground">Loading profile settings...</p>;
  }

  if (!profile) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-destructive">
          {errorMessage ?? 'Profile settings are unavailable right now.'}
        </p>
        <Button variant="outline" onClick={() => void loadProfile()} disabled={isLoading}>
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {errorMessage ? <p className="text-sm text-destructive">{errorMessage}</p> : null}
      <div className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Profile</h2>
          <p className="text-muted-foreground text-sm">
            Update your display name and profile image.
          </p>
        </div>
        <div className="space-y-4 rounded-lg border p-4">
          <ProfileImageForm
            initialImageUrl={profile.imageUrl}
            fallbackName={profile.name || profile.email}
          />
          <Separator />
          <ProfileNameForm initialName={profile.name} />
          <Separator />
          <ProfileUsernameForm initialUsername={profile.username} />
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
