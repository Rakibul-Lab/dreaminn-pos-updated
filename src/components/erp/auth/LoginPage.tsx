'use client';

import { useState } from 'react';
import Image from 'next/image';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { EmailInput } from '@/components/ui/email-input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Eye, EyeOff, Loader2, KeyRound, Hotel, UtensilsCrossed } from 'lucide-react';
import { api } from '@/lib/api-client';
import { useAuthStore } from '@/lib/auth-store';
import { toast } from 'sonner';
import { AppDevelopedByFooter } from '@/components/AppDevelopedByFooter';

export function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [emailBlocking, setEmailBlocking] = useState(false);
  const login = useAuthStore((s) => s.login);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      toast.error('Please enter email and password');
      return;
    }
    if (emailBlocking) {
      toast.error('Enter a valid email address');
      return;
    }

    setLoading(true);
    try {
      const res = await api.post<{ success: boolean; data?: { user: { id: string; email: string; name: string; avatar?: string | null; role: 'ADMIN' | 'HOTEL_STAFF' | 'HOTEL_FD' | 'RESTAURANT_STAFF' | 'HOUSEKEEPER' }; token: string }; error?: string }>('/auth/login', { email, password });
      if (res.success && res.data) {
        login(res.data.user, res.data.token);
        toast.success(`Welcome back, ${res.data.user.name}!`);
      } else {
        toast.error(res.error || 'Invalid credentials');
      }
    } catch {
      toast.error('Login failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-amber-50 via-orange-50 to-emerald-50">
      <div className="relative flex-1 flex items-center justify-center p-4">
      {/* Background decorations */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-amber-200/30 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-emerald-200/30 rounded-full blur-3xl" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-orange-100/20 rounded-full blur-3xl" />
      </div>

      <div className="relative w-full max-w-md">
        <Card className="shadow-xl border-0 bg-card/80 backdrop-blur-sm">
          <CardContent className="p-6 pt-6">
            <div className="text-center mb-6 pb-6 border-b border-border">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-white shadow-lg mb-4 border border-border overflow-hidden">
                <Image
                  src="/brand-logo.png"
                  alt="RRP Dream Inn logo"
                  width={64}
                  height={64}
                  className="h-full w-full object-cover"
                />
              </div>
              <h1 className="text-2xl font-bold text-foreground">ERP System</h1>
              <div className="flex flex-wrap items-center justify-center gap-2 mt-2">
                <Badge className="bg-amber-100 text-amber-700 border-amber-200 hover:bg-amber-100">
                  <Hotel className="h-3 w-3 mr-1" />
                  RRP Dream Inn
                </Badge>
                <span className="text-muted-foreground">+</span>
                <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 hover:bg-emerald-100">
                  <UtensilsCrossed className="h-3 w-3 mr-1" />
                  CloudView
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground mt-2">Hotel & Restaurant ERP System</p>
            </div>

            <CardHeader className="p-0 pb-4">
              <CardTitle className="text-xl flex items-center gap-2">
                <KeyRound className="w-5 h-5 text-amber-600" />
                Sign In
              </CardTitle>
              <CardDescription>Enter your credentials to access the system</CardDescription>
            </CardHeader>

            <form onSubmit={handleLogin} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <EmailInput
                  id="email"
                  placeholder="your@email.com"
                  value={email}
                  onChange={setEmail}
                  mode="format-only"
                  onValidationChange={(result) => setEmailBlocking(result.isBlocking)}
                  disabled={loading}
                  className="h-11"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    placeholder="Enter your password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={loading}
                    className="h-11 pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              <Button
                type="submit"
                className="w-full h-11 bg-gradient-to-r from-amber-600 to-amber-700 hover:from-amber-700 hover:to-amber-800 text-white shadow-md"
                disabled={loading}
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Signing in...
                  </>
                ) : (
                  'Sign In'
                )}
              </Button>
            </form>
          </CardContent>
        </Card>

      </div>
      </div>
      <AppDevelopedByFooter showProductLine />
    </div>
  );
}
