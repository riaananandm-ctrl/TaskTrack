'use client';

import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase/client';
import { Profile, UserSettings, YEAR_GROUPS } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from '@/components/ui/alert-dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import Link from 'next/link';
import {
  User, Palette, Bell, BookOpen, Database, Shield, LogOut, Loader2, Check, AlertCircle, Moon, Sun, Download, Upload, Trash2, Link2, Crown, MonitorSmartphone, RotateCcw, Sparkles,
} from 'lucide-react';
import { useFont } from '@/lib/font-provider';
import { FONT_OPTIONS, DEFAULT_FONT_ID } from '@/lib/fonts';
import { useTheme } from '@/lib/theme-provider';
import { isRememberDevice, REMEMBER_DEVICE_NOTICE } from '@/lib/remember-device';
import { PlanComparison } from '@/components/plan-comparison';
import { ProFeatureGate } from '@/components/pro-feature-gate';
import { getProfileEntitlements } from '@/lib/entitlements';
import { PushNotificationsCard } from '@/components/push-notifications-card';
import { IntegrationsPanel } from '@/components/integrations-panel';
import { cn } from '@/lib/utils';
import { useRouter } from 'next/navigation';

export default function SettingsPage() {
  const { user, profile, signOut, forgetDevice, refreshProfile } = useAuth();
  const router = useRouter();
  const { fontId, setFont, resetFont } = useFont();
  const { theme, setTheme } = useTheme();
  const [remembered, setRemembered] = useState(false);
  const [forgetting, setForgetting] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deletePassword, setDeletePassword] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [savedProfile, setSavedProfile] = useState(false);
  const [savedSettings, setSavedSettings] = useState(false);
  const [deleteAccountOpen, setDeleteAccountOpen] = useState(false);
  const [deleteTasksOpen, setDeleteTasksOpen] = useState(false);
  const [planNotice, setPlanNotice] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState('profile');
  const [accountOpen, setAccountOpen] = useState(false);

  const entitlements = getProfileEntitlements(profile);

  // Payment processing is not connected yet, so this must not imply a purchase.
  const handleUpgrade = () => {
    setPlanNotice(
      'Checkout isn\u2019t connected yet, so no payment has been taken and no charge will be made. Your plan is unchanged.'
    );
  };

  const [profileForm, setProfileForm] = useState({
    full_name: '',
    email: '',
    year_group: '',
    school_name: '',
    timezone: 'UTC',
  });

  const [settingsForm, setSettingsForm] = useState({
    task_reminders_enabled: true,
    overdue_reminders_enabled: true,
    daily_summary_enabled: false,
    weekly_summary_enabled: false,
    quiet_hours_start: '22:00',
    quiet_hours_end: '07:00',
    preferred_reminder_time: '08:00',
    compact_view: false,
  });
  // The "email me the day before" preference. Kept out of settingsForm and only saved
  // when the database has the column, so Settings keeps saving before that migration runs.
  const [emailReminders, setEmailReminders] = useState<boolean | null>(null);

  const fetchSettings = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase.from('user_settings').select('*').eq('user_id', user.id).maybeSingle();
    if (data) {
      setSettings(data as UserSettings);
      setSettingsForm({
        task_reminders_enabled: data.task_reminders_enabled,
        overdue_reminders_enabled: data.overdue_reminders_enabled,
        daily_summary_enabled: data.daily_summary_enabled,
        weekly_summary_enabled: data.weekly_summary_enabled,
        quiet_hours_start: data.quiet_hours_start,
        quiet_hours_end: data.quiet_hours_end,
        preferred_reminder_time: data.preferred_reminder_time,
        compact_view: data.compact_view,
      });
      const emailPref = (data as { email_reminders_enabled?: boolean }).email_reminders_enabled;
      setEmailReminders(typeof emailPref === 'boolean' ? emailPref : null);
    }
    setLoading(false);
  }, [user]);

  useEffect(() => {
    if (profile) {
      setProfileForm({
        full_name: profile.full_name || '',
        email: profile.email || '',
        year_group: profile.year_group || '',
        school_name: profile.school_name || '',
        timezone: profile.timezone || 'UTC',
      });
    }
    if (user && !profile) {
      setProfileForm((prev) => ({ ...prev, email: user.email || '' }));
    }
  }, [profile, user]);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  useEffect(() => {
    setRemembered(isRememberDevice());
  }, []);

  const handleForgetDevice = async () => {
    setForgetting(true);
    await forgetDevice();
    router.push('/login?message=session-ended');
  };

  const saveProfile = async () => {
    if (!user) return;
    setSavingProfile(true);
    await supabase.from('profiles').update({
      full_name: profileForm.full_name,
      year_group: profileForm.year_group || null,
      school_name: profileForm.school_name || null,
      timezone: profileForm.timezone,
    }).eq('id', user.id);
    await refreshProfile();
    setSavingProfile(false);
    setSavedProfile(true);
    setTimeout(() => setSavedProfile(false), 2000);
  };

  const saveSettings = async () => {
    if (!user) return;
    setSavingSettings(true);
    await supabase.from('user_settings').upsert(
      {
        ...settingsForm,
        ...(emailReminders === null ? {} : { email_reminders_enabled: emailReminders }),
        user_id: user.id,
      },
      { onConflict: 'user_id' }
    );
    setSavingSettings(false);
    setSavedSettings(true);
    setTimeout(() => setSavedSettings(false), 2000);
  };

  const handleDeleteAccount = async () => {
    if (!user || deleting) return;
    setDeleteError(null);

    if (deleteConfirmText.trim().toUpperCase() !== 'DELETE MY ACCOUNT') {
      setDeleteError('Please type DELETE MY ACCOUNT exactly to confirm.');
      return;
    }
    if (!deletePassword) {
      setDeleteError('Please enter your password to confirm.');
      return;
    }

    setDeleting(true);
    try {
      // Recent reauthentication: prove it is really the account owner.
      const { error: reauthError } = await supabase.auth.signInWithPassword({
        email: user.email || '',
        password: deletePassword,
      });
      if (reauthError) {
        setDeleteError('That password is not correct. Please try again.');
        setDeleting(false);
        return;
      }

      // Deletion runs only on the server. The browser holds no service-role key,
      // and the server derives the account from this session's token.
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('/api/delete-account', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token ?? ''}`,
        },
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.ok) {
        setDeleteError(
          (body?.error?.message as string) ||
            'Your account could not be deleted. Please try again.'
        );
        setDeleting(false);
        return;
      }

      await signOut();
      router.push('/login?message=session-ended');
    } catch {
      setDeleteError('Your account could not be deleted. Please try again.');
      setDeleting(false);
    }
  };

  const handleDeleteAllTasks = async () => {
    if (!user) return;
    await supabase.from('tasks').delete().eq('user_id', user.id);
    setDeleteTasksOpen(false);
  };

  const initials = (profileForm.full_name || user?.email || '?')
    .split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2);

  if (loading) {
    return <div className="flex items-center justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>;
  }

  return (
    <div className="space-y-6 animate-fade-in max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">Manage your account and preferences</p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="w-full justify-start h-auto overflow-x-auto sm:flex-wrap sm:overflow-x-visible gap-1">
          <TabsTrigger value="profile"><User className="w-3.5 h-3.5 mr-1" /> Profile</TabsTrigger>
          <TabsTrigger value="appearance"><Palette className="w-3.5 h-3.5 mr-1" /> Appearance</TabsTrigger>
          <TabsTrigger value="notifications"><Bell className="w-3.5 h-3.5 mr-1" /> Notifications</TabsTrigger>
          <TabsTrigger value="data"><Database className="w-3.5 h-3.5 mr-1" /> Data</TabsTrigger>
          <TabsTrigger value="privacy"><Shield className="w-3.5 h-3.5 mr-1" /> Privacy</TabsTrigger>
          <TabsTrigger value="integrations"><Link2 className="w-3.5 h-3.5 mr-1" /> Integrations</TabsTrigger>
          <TabsTrigger value="plan"><Crown className="w-3.5 h-3.5 mr-1" /> Plan</TabsTrigger>
        </TabsList>

        {/* Profile */}
        <TabsContent value="profile" className="space-y-4">
          <Card className="p-6">
            <div className="flex items-center gap-4 mb-6">
              <Avatar className="w-16 h-16">
                <AvatarFallback className="bg-primary text-primary-foreground text-xl font-bold">{initials}</AvatarFallback>
              </Avatar>
              <div>
                <p className="font-semibold">{profileForm.full_name || 'Your name'}</p>
                <p className="text-sm text-muted-foreground">{profileForm.email}</p>
                <p className="text-xs text-muted-foreground mt-1">Profile image coming soon</p>
              </div>
            </div>

            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="full_name">Full name</Label>
                <Input id="full_name" value={profileForm.full_name} onChange={(e) => setProfileForm({ ...profileForm, full_name: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" value={profileForm.email} disabled className="bg-muted/50" />
                <p className="text-xs text-muted-foreground">Email cannot be changed here.</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="year_group">Year group</Label>
                  <Select value={profileForm.year_group} onValueChange={(v) => setProfileForm({ ...profileForm, year_group: v })}>
                    <SelectTrigger><SelectValue placeholder="Select year group" /></SelectTrigger>
                    <SelectContent>
                      {YEAR_GROUPS.map((yg) => <SelectItem key={yg} value={yg}>{yg}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="school_name">School name</Label>
                  <Input id="school_name" value={profileForm.school_name} onChange={(e) => setProfileForm({ ...profileForm, school_name: e.target.value })} placeholder="Optional" />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="timezone">Timezone</Label>
                <Input id="timezone" value={profileForm.timezone} onChange={(e) => setProfileForm({ ...profileForm, timezone: e.target.value })} placeholder="e.g. Europe/London" />
              </div>
              <Button onClick={saveProfile} disabled={savingProfile}>
                {savingProfile ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : savedProfile ? <Check className="w-4 h-4 mr-2" /> : null}
                {savedProfile ? 'Saved!' : 'Save profile'}
              </Button>
            </div>
          </Card>

          <Card className="p-6">
            <h3 className="font-semibold mb-4">Account</h3>
            <div className="space-y-3">
              <Link href="/app/subjects" className="flex items-center gap-2 text-sm text-primary hover:underline">
                <BookOpen className="w-4 h-4" /> Manage subjects
              </Link>
              <Link href="/starter" className="flex items-center gap-2 text-sm text-primary hover:underline">
                <Sparkles className="w-4 h-4" /> Show me how to use TaskTrack
              </Link>
              <button
                type="button"
                onClick={() => setActiveTab('integrations')}
                className="flex items-center gap-2 text-sm text-primary hover:underline"
              >
                <Link2 className="w-4 h-4" /> Manage integrations
              </button>
              <button onClick={signOut} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
                <LogOut className="w-4 h-4" /> Log out
              </button>
            </div>
          </Card>

          <Card className="p-6">
            <h3 className="font-semibold mb-1 flex items-center gap-2">
              <MonitorSmartphone className="w-4 h-4 text-primary" /> This device
            </h3>
            <p className="text-sm text-muted-foreground">
              {remembered
                ? `This browser is set to stay signed in. ${REMEMBER_DEVICE_NOTICE}`
                : 'This browser is not set to stay signed in after it closes.'}
            </p>
            {remembered && (
              <Button
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={handleForgetDevice}
                disabled={forgetting}
              >
                {forgetting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Forget this device
              </Button>
            )}
          </Card>
        </TabsContent>

        {/* Appearance */}
        <TabsContent value="appearance" className="space-y-4">
          <Card className="p-6">
            <h3 className="font-semibold mb-1">Theme</h3>
            <p className="text-xs text-muted-foreground mb-4">Applies immediately and is remembered on this device and your account.</p>
            <div className="grid grid-cols-3 gap-3" role="radiogroup" aria-label="Theme">
              {([
                { id: 'light', label: 'Light', icon: Sun },
                { id: 'dark', label: 'Dark', icon: Moon },
                { id: 'system', label: 'System', icon: MonitorSmartphone },
              ] as const).map((option) => {
                const active = theme === option.id;
                return (
                  <button
                    key={option.id}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => setTheme(option.id)}
                    className={cn(
                      'flex flex-col items-center gap-2 p-4 rounded-lg border-2 transition-all',
                      active ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/30'
                    )}
                  >
                    <option.icon className="w-5 h-5" />
                    <span className="text-sm font-medium">{option.label}</span>
                  </button>
                );
              })}
            </div>
          </Card>

          <Card className="p-6">
            <div className="flex items-start justify-between gap-3 mb-4">
              <div>
                <h3 className="font-semibold">Reading font</h3>
                <p className="text-xs text-muted-foreground mt-0.5">Choose the font used across TaskTrack. Icons and code blocks are not affected.</p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => resetFont()}
                disabled={fontId === DEFAULT_FONT_ID}
              >
                <RotateCcw className="w-3.5 h-3.5 mr-1" /> Reset
              </Button>
            </div>

            <div className="space-y-2" role="radiogroup" aria-label="App font">
              {FONT_OPTIONS.map((font) => {
                const active = fontId === font.id;
                return (
                  <button
                    key={font.id}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => setFont(font.id)}
                    className={cn(
                      'w-full flex items-center gap-3 p-3 rounded-lg border-2 text-left transition-all',
                      active ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/30'
                    )}
                  >
                    <div className={cn('w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0', active ? 'border-primary' : 'border-muted-foreground/40')}>
                      {active && <div className="w-2.5 h-2.5 rounded-full bg-primary" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold" style={{ fontFamily: `var(${font.variable})` }}>{font.label}</p>
                      <p className="text-xs text-muted-foreground" style={{ fontFamily: `var(${font.variable})` }}>{font.description}</p>
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="mt-4 rounded-lg border border-border p-4">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Live preview</p>
              <p className="text-base">Plan your week, stay on top of deadlines.</p>
              <p className="text-sm text-muted-foreground mt-1">The quick brown fox jumps over the lazy dog &mdash; 1234567890</p>
              <p className="text-sm mt-2">
                <span className="font-mono rounded bg-muted px-1.5 py-0.5 text-xs">code blocks keep their font</span>
              </p>
            </div>
          </Card>

          <Card className="p-6">
            <h3 className="font-semibold mb-4">Display density</h3>
            <div className="flex items-center justify-between p-3 rounded-lg border border-border">
              <div>
                <p className="text-sm font-medium">Compact view</p>
                <p className="text-xs text-muted-foreground">Show more tasks in less space</p>
              </div>
              <Switch checked={settingsForm.compact_view} onCheckedChange={(v) => setSettingsForm({ ...settingsForm, compact_view: v })} />
            </div>
          </Card>

          <Button onClick={saveSettings} disabled={savingSettings}>
            {savingSettings ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : savedSettings ? <Check className="w-4 h-4 mr-2" /> : null}
            {savedSettings ? 'Saved!' : 'Save appearance'}
          </Button>
        </TabsContent>

        {/* Notifications */}
        <TabsContent value="notifications" className="space-y-4">
          <Card className="p-6">
            <PushNotificationsCard />
          </Card>

          <Card className="p-6 space-y-4">
            <h3 className="font-semibold">Reminder preferences</h3>
            {[
              { key: 'task_reminders_enabled', label: 'Task reminders', desc: 'A reminder the day before each task is due' },
              { key: 'overdue_reminders_enabled', label: 'Overdue reminders', desc: 'Get notified about overdue tasks' },
              { key: 'daily_summary_enabled', label: 'Daily summary', desc: 'A daily overview of what is due' },
              { key: 'weekly_summary_enabled', label: 'Weekly summary', desc: 'A weekly planning reminder' },
            ].map((item) => (
              <div key={item.key} className="flex items-center justify-between p-3 rounded-lg border border-border">
                <div>
                  <p className="text-sm font-medium">{item.label}</p>
                  <p className="text-xs text-muted-foreground">{item.desc}</p>
                </div>
                <Switch
                  checked={settingsForm[item.key as keyof typeof settingsForm] as boolean}
                  onCheckedChange={(v) => setSettingsForm({ ...settingsForm, [item.key]: v })}
                />
              </div>
            ))}
            {emailReminders !== null && (
              <div className="flex items-center justify-between p-3 rounded-lg border border-border">
                <div>
                  <p className="text-sm font-medium">Email reminders</p>
                  <p className="text-xs text-muted-foreground">Also email me the day before a task is due</p>
                </div>
                <Switch
                  checked={emailReminders}
                  disabled={!settingsForm.task_reminders_enabled}
                  onCheckedChange={(v) => setEmailReminders(v)}
                  aria-label="Email reminders"
                />
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="quiet_start">Quiet hours start</Label>
                <Input id="quiet_start" type="time" value={settingsForm.quiet_hours_start} onChange={(e) => setSettingsForm({ ...settingsForm, quiet_hours_start: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="quiet_end">Quiet hours end</Label>
                <Input id="quiet_end" type="time" value={settingsForm.quiet_hours_end} onChange={(e) => setSettingsForm({ ...settingsForm, quiet_hours_end: e.target.value })} />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="preferred_time">Default reminder time</Label>
              <Input id="preferred_time" type="time" value={settingsForm.preferred_reminder_time} onChange={(e) => setSettingsForm({ ...settingsForm, preferred_reminder_time: e.target.value })} />
              <p className="text-xs text-muted-foreground">&ldquo;Due tomorrow&rdquo; reminders arrive at this time the day before.</p>
            </div>
            <Button onClick={saveSettings} disabled={savingSettings}>
              {savingSettings ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : savedSettings ? <Check className="w-4 h-4 mr-2" /> : null}
              {savedSettings ? 'Saved!' : 'Save notification settings'}
            </Button>
          </Card>
        </TabsContent>

        {/* Data */}
        <TabsContent value="data" className="space-y-4">
          <Card className="p-6 space-y-4">
            <h3 className="font-semibold">Data management</h3>
            <div className="space-y-3">
              <div className="flex items-center justify-between p-3 rounded-lg border border-border">
                <div className="flex items-center gap-3">
                  <Download className="w-4 h-4 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium">Export tasks</p>
                    <p className="text-xs text-muted-foreground">Download your task data</p>
                  </div>
                </div>
                <Button variant="outline" size="sm" disabled>Coming soon</Button>
              </div>
              <div className="flex items-center justify-between p-3 rounded-lg border border-border">
                <div className="flex items-center gap-3">
                  <Upload className="w-4 h-4 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium">Import tasks</p>
                    <p className="text-xs text-muted-foreground">Upload tasks from a file</p>
                  </div>
                </div>
                <Button variant="outline" size="sm" disabled>Coming soon</Button>
              </div>
              <div className="flex items-center justify-between p-3 rounded-lg border border-red-200 dark:border-red-900">
                <div className="flex items-center gap-3">
                  <Trash2 className="w-4 h-4 text-destructive" />
                  <div>
                    <p className="text-sm font-medium text-destructive">Delete all tasks</p>
                    <p className="text-xs text-muted-foreground">Permanently remove all your tasks</p>
                  </div>
                </div>
                <Button variant="destructive" size="sm" onClick={() => setDeleteTasksOpen(true)}>Delete</Button>
              </div>
            </div>
          </Card>
        </TabsContent>

        {/* Integrations */}
        <TabsContent value="integrations" className="space-y-4">
          <IntegrationsPanel />
        </TabsContent>

        {/* Plan */}
        <TabsContent value="plan" className="space-y-4">
          <Card className="p-6">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div>
                <h3 className="font-semibold flex items-center gap-2">
                  <Crown className="w-4 h-4 text-primary" /> Your plan: {entitlements.name}
                </h3>
                <p className="text-sm text-muted-foreground mt-1">
                  {entitlements.dailyAiMessages} TaskTrack AI messages per day · {entitlements.maxMessageChars.toLocaleString()} characters per message
                </p>
                <p className="text-xs text-muted-foreground mt-2">
                  TaskTrack AI is included with your account and shared across everyone using
                  TaskTrack. You never need your own API key.
                </p>
              </div>
            </div>
          </Card>

          <PlanComparison onUpgrade={handleUpgrade} upgradeNotice={planNotice} />

          <ProFeatureGate
            feature="advancedAnalytics"
            title="Advanced study analytics"
            description="See study progress over time and which topics need the most attention."
          >
            <Card className="p-6">
              <h3 className="font-semibold mb-2">Study progress</h3>
              <p className="text-sm text-muted-foreground">Your advanced analytics will appear here.</p>
            </Card>
          </ProFeatureGate>
        </TabsContent>

        {/* Privacy */}
        <TabsContent value="privacy" className="space-y-4">
          <Card className="p-6 space-y-4">
            <h3 className="font-semibold">Security and privacy</h3>
            <div className="space-y-3 text-sm text-muted-foreground">
              <p>Your data belongs to you. TaskTrack stores your information securely in Supabase with row-level security policies.</p>
              <p>Each user can only access their own profiles, subjects, tasks, reminders, plans and settings. No other user can see or edit your data.</p>
              <p>Service keys and private tokens are never exposed in the frontend. All sensitive operations are handled securely.</p>
            </div>
            <div className="flex items-center justify-between p-3 rounded-lg border border-red-200 dark:border-red-900">
              <div className="flex items-center gap-3">
                <AlertCircle className="w-4 h-4 text-destructive" />
                <div>
                  <p className="text-sm font-medium text-destructive">Delete account</p>
                  <p className="text-xs text-muted-foreground">Permanently delete your account and data</p>
                </div>
              </div>
              <Button variant="destructive" size="sm" onClick={() => setDeleteAccountOpen(true)}>Delete account</Button>
            </div>
          </Card>
        </TabsContent>
      </Tabs>

      <AlertDialog open={deleteAccountOpen} onOpenChange={(o) => { setDeleteAccountOpen(o); if (!o) { setDeleteConfirmText(''); setDeletePassword(''); setDeleteError(null); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete account permanently?</AlertDialogTitle>
            <AlertDialogDescription>
              This cannot be undone. Your account, tasks, study sessions, session messages, reminders,
              preferences and connected integrations will be permanently removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="delete-confirm">Type DELETE MY ACCOUNT to confirm</Label>
              <Input
                id="delete-confirm"
                value={deleteConfirmText}
                onChange={(e) => setDeleteConfirmText(e.target.value)}
                placeholder="DELETE MY ACCOUNT"
                autoComplete="off"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="delete-password">Your password</Label>
              <Input
                id="delete-password"
                type="password"
                value={deletePassword}
                onChange={(e) => setDeletePassword(e.target.value)}
                placeholder="Confirm with your password"
                autoComplete="current-password"
              />
            </div>
            {deleteError && (
              <div className="flex items-center gap-2 p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                {deleteError}
              </div>
            )}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); handleDeleteAccount(); }}
              disabled={deleting || deleteConfirmText.trim().toUpperCase() !== 'DELETE MY ACCOUNT' || !deletePassword}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50"
            >
              {deleting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {deleting ? 'Deleting...' : 'Delete permanently'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={deleteTasksOpen} onOpenChange={setDeleteTasksOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete all tasks?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete all your tasks. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteAllTasks} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete all
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
