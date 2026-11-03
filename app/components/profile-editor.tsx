'use client';

import { Button, LoadingSkeleton, MaskedInput, TextArea, TextInput, Toast } from '@/app/components/ui';
import { useEffect, useState, type ChangeEvent, type ComponentProps, type FormEvent } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import CameraCapture from '@/app/components/camera-capture';
import { isValidCnpj, isValidCpf, normalizeDocument } from '@/lib/validations/br-documents';
import ProfileProgress from '@/app/components/profile-progress';
import { getProfileProgress } from '@/lib/ui/profile-progress';
import { DashboardLogo } from '@/app/components/dashboard-identity';

type ProfileRole = 'worker' | 'restaurant';

interface WorkerProfile {
  cpf: string;
  rg: string;
  date_of_birth: string;
  phone: string;
  whatsapp: string;
  address: string;
  city: string;
  state: string;
  postal_code: string;
  bio: string;
  experience: string;
  specialties: string;
  profile_photo_path: string;
  selfie_verification_path: string;
}

interface RestaurantProfile {
  cnpj: string;
  legal_name: string;
  trade_name: string;
  phone: string;
  whatsapp: string;
  address: string;
  city: string;
  state: string;
  postal_code: string;
  description: string;
  logo_path: string;
  company_photos: string[];
}

const emptyWorkerProfile: WorkerProfile = {
  cpf: '',
  rg: '',
  date_of_birth: '',
  phone: '',
  whatsapp: '',
  address: '',
  city: '',
  state: '',
  postal_code: '',
  bio: '',
  experience: '',
  specialties: '',
  profile_photo_path: '',
  selfie_verification_path: '',
};

const emptyRestaurantProfile: RestaurantProfile = {
  cnpj: '',
  legal_name: '',
  trade_name: '',
  phone: '',
  whatsapp: '',
  address: '',
  city: '',
  state: '',
  postal_code: '',
  description: '',
  logo_path: '',
  company_photos: [],
};


function getFileExtension(file: File) {
  if (file.type === 'image/png') return 'png';
  if (file.type === 'image/webp') return 'webp';
  return 'jpg';
}

export default function ProfileEditor({ role }: { role: ProfileRole }) {
  const [supabase] = useState(() => createClient());
  const [userId, setUserId] = useState('');
  const [accountName, setAccountName] = useState('');
  const [workerProfile, setWorkerProfile] = useState<WorkerProfile>(emptyWorkerProfile);
  const [restaurantProfile, setRestaurantProfile] = useState<RestaurantProfile>(emptyRestaurantProfile);
  const [profilePhotoFile, setProfilePhotoFile] = useState<File | null>(null);
  const [selfieFile, setSelfieFile] = useState<File | null>(null);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [companyPhotoFiles, setCompanyPhotoFiles] = useState<File[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  useEffect(() => {
    let isMounted = true;

    async function loadProfile() {
      const { data: authData, error: authError } = await supabase.auth.getUser();
      if (authError || !authData.user) {
        if (isMounted) {
          setErrorMessage('Entre na sua conta para editar o perfil.');
          setLoading(false);
        }
        return;
      }

      const userIdValue = authData.user.id;
      const { data: user, error: userError } = await supabase
        .from('public_user_directory')
        .select('name, role, city')
        .eq('id', userIdValue)
        .single();

      if (userError || user.role !== role) {
        if (isMounted) {
          setErrorMessage('Este perfil não corresponde ao tipo da sua conta.');
          setLoading(false);
        }
        return;
      }

      if (!isMounted) return;
      setUserId(userIdValue);
      setAccountName(user.name ?? '');

      if (role === 'worker') {
        const { data, error } = await supabase
          .from('worker_profiles')
          .select('cpf, rg, date_of_birth, phone, whatsapp, address, city, state, postal_code, bio, experience, specialties, profile_photo_path, selfie_verification_path')
          .eq('user_id', userIdValue)
          .maybeSingle();
        if (error) setErrorMessage(error.message);
        else if (data) {
          setWorkerProfile({
            ...emptyWorkerProfile,
            ...data,
            specialties: (data.specialties ?? []).join(', '),
          });
        } else {
          setWorkerProfile((current) => ({ ...current, city: user.city ?? '' }));
        }
      } else {
        const { data, error } = await supabase
          .from('restaurant_profiles')
          .select('*')
          .eq('user_id', userIdValue)
          .maybeSingle();
        if (error) setErrorMessage(error.message);
        else if (data) {
          setRestaurantProfile({ ...emptyRestaurantProfile, ...data, company_photos: data.company_photos ?? [] });
        } else {
          setRestaurantProfile((current) => ({
            ...current,
            trade_name: user.name ?? '',
            city: user.city ?? '',
          }));
        }
      }

      setLoading(false);
    }

    void loadProfile();
    return () => {
      isMounted = false;
    };
  }, [role, supabase]);

  const uploadFile = async (file: File, bucket: string, category: string) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowedTypes.includes(file.type)) throw new Error('Formato de arquivo não permitido.');
    if (file.size > 10 * 1024 * 1024) throw new Error('Cada arquivo deve ter no máximo 10 MB.');

    const path = `${userId}/${category}-${crypto.randomUUID()}.${getFileExtension(file)}`;
    const { data, error } = await supabase.storage.from(bucket).upload(path, file, {
      contentType: file.type,
      cacheControl: '3600',
      upsert: false,
    });
    if (error) throw new Error(error.message);
    return data.path;
  };

  const handleCompanyPhotos = (event: ChangeEvent<HTMLInputElement>) => {
    setCompanyPhotoFiles(Array.from(event.target.files ?? []));
  };

  const saveProfile = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!userId || saving) return;
    setErrorMessage('');
    setSuccessMessage('');

    if (role === 'worker' && !isValidCpf(workerProfile.cpf)) {
      setErrorMessage('Confira o CPF. Os dígitos verificadores não são válidos.');
      return;
    }
    if (role === 'restaurant' && !isValidCnpj(restaurantProfile.cnpj)) {
      setErrorMessage('Confira o CNPJ. Os dígitos verificadores não são válidos.');
      return;
    }

    setSaving(true);
    try {
      if (role === 'worker') {
        const [profilePhotoPath, selfiePath] = await Promise.all([
          profilePhotoFile ? uploadFile(profilePhotoFile, 'worker-private', 'profile-photo') : Promise.resolve(workerProfile.profile_photo_path || null),
          selfieFile ? uploadFile(selfieFile, 'worker-private', 'selfie') : Promise.resolve(workerProfile.selfie_verification_path || null),
        ]);

        // Keep the legacy NOT NULL value; this field is no longer editable by workers.
        const { error } = await supabase.from('worker_profiles').upsert({
          user_id: userId,
          ...workerProfile,
          cpf: normalizeDocument(workerProfile.cpf),
          specialties: workerProfile.specialties.split(',').map((item) => item.trim()).filter(Boolean),
          profile_photo_path: profilePhotoPath,
          selfie_verification_path: selfiePath,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id' });
        if (error) throw new Error(error.message);

        const { error: summaryError } = await supabase.rpc('update_own_profile_summary', {
          p_name: accountName,
          p_city: workerProfile.city,
          p_phone: workerProfile.phone,
        });
        if (summaryError) throw new Error(summaryError.message);
        setWorkerProfile((current) => ({
          ...current,
          profile_photo_path: profilePhotoPath ?? '',
          selfie_verification_path: selfiePath ?? '',
        }));
      } else {
        const [logoPath, uploadedPhotos] = await Promise.all([
          logoFile ? uploadFile(logoFile, 'restaurant-assets', 'logo') : Promise.resolve(restaurantProfile.logo_path || null),
          Promise.all(companyPhotoFiles.map((file) => uploadFile(file, 'restaurant-assets', 'company-photo'))),
        ]);

        const { error } = await supabase.from('restaurant_profiles').upsert({
          user_id: userId,
          ...restaurantProfile,
          cnpj: normalizeDocument(restaurantProfile.cnpj),
          company_photos: [...restaurantProfile.company_photos, ...uploadedPhotos],
          logo_path: logoPath,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id' });
        if (error) throw new Error(error.message);

        const { error: summaryError } = await supabase.rpc('update_own_profile_summary', {
          p_name: restaurantProfile.trade_name,
          p_city: restaurantProfile.city,
          p_phone: restaurantProfile.phone,
        });
        if (summaryError) throw new Error(summaryError.message);
        setRestaurantProfile((current) => ({
          ...current,
          logo_path: logoPath ?? '',
          company_photos: [...current.company_photos, ...uploadedPhotos],
        }));
      }
      setSuccessMessage('Perfil salvo com sucesso.');
      setProfilePhotoFile(null);
      setSelfieFile(null);
      setLogoFile(null);
      setCompanyPhotoFiles([]);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Não foi possível salvar o perfil.');
    } finally {
      setSaving(false);
    }
  };

  const updateWorker = <K extends keyof WorkerProfile>(key: K, value: WorkerProfile[K]) => {
    setWorkerProfile((current) => ({ ...current, [key]: value }));
  };

  const updateRestaurant = <K extends keyof RestaurantProfile>(key: K, value: RestaurantProfile[K]) => {
    setRestaurantProfile((current) => ({ ...current, [key]: value }));
  };

  const input = (label: string, value: string, onChange: (value: string) => void, props: ComponentProps<'input'> = {}) => {
    const mask = label === 'CPF' ? 'cpf' : label === 'CNPJ' ? 'cnpj'
      : label === 'CEP' ? 'postal-code' : label === 'Telefone' || label === 'WhatsApp' ? 'phone' : null;
    return (
      <label className="block space-y-1.5">
        <span className="text-sm font-medium text-gray-700">{label}</span>
        {mask
          ? <MaskedInput autoComplete={props.autoComplete} required mask={mask} value={value} onValueChange={onChange} />
          : <TextInput {...props} value={value} onChange={(event) => onChange(event.target.value)} required />}
      </label>
    );
  };

  const fileInput = (label: string, accept: string, onChange: (file: File | null) => void, currentPath?: string, capture?: 'user' | 'environment') => (
    <label className="block space-y-2">
      <span className="text-sm font-medium text-gray-700">{label}</span>
      <TextInput
        type="file"
        accept={accept}
        capture={capture}
        onChange={(event) => onChange(event.target.files?.[0] ?? null)}
        className="w-full"
      />
      <span className="block break-all text-xs text-gray-500">
        {currentPath ? 'Arquivo salvo. Envie outro para substituir.' : 'Opcional; máximo de 10 MB.'}
      </span>
    </label>
  );

  if (loading) {
    return <main className="flex min-h-screen items-center justify-center p-4"><LoadingSkeleton label="Carregando perfil" /></main>;
  }

  if (errorMessage && !userId) {
    return <main className="mx-auto max-w-xl p-6"><Toast tone="error">{errorMessage}</Toast><Link href="/login" className="mt-4 inline-flex min-h-12 items-center font-semibold text-orange-700">Fazer login</Link></main>;
  }

  return (
    <main className="min-h-screen bg-gray-50 px-4 py-6 pb-28 sm:px-6 sm:py-10 md:pb-10">
      <section className="mx-auto max-w-2xl space-y-6">
        <header className="flex items-center justify-between gap-3">
          <div>
            <DashboardLogo role={role} />
            <h1 className="mt-1 text-2xl font-bold text-gray-950">Editar perfil</h1>
          </div>
          <Link href={role === 'worker' ? '/worker/profile/details' : '/restaurant/profile'} className="inline-flex min-h-12 items-center text-sm font-semibold text-gray-600">Cancelar</Link>
        </header>

        {errorMessage && <Toast tone="error">{errorMessage}</Toast>}
        {successMessage && <Toast tone="success">{successMessage}</Toast>}
        <ProfileProgress progress={getProfileProgress(role, role === 'worker' ? accountName : restaurantProfile.trade_name, role === 'worker' ? {
          ...workerProfile,
          profile_photo_path: profilePhotoFile ? 'selected' : workerProfile.profile_photo_path,
        } : {
          ...restaurantProfile,
          logo_path: logoFile ? 'selected' : restaurantProfile.logo_path,
        })} />
        <p className="text-xs text-gray-600">O indicador acompanha o formulário. Salve as alterações para atualizar seu perfil.</p>

        <form onSubmit={saveProfile} className="ec-card space-y-6">
          {role === 'worker' ? (
            <>
              <h2 className="text-lg font-semibold text-gray-900">Dados profissionais</h2>
              {input('Nome completo', accountName, setAccountName, { autoComplete: 'name' })}
              <div className="grid gap-4 sm:grid-cols-2">
                {input('CPF', workerProfile.cpf, (value) => updateWorker('cpf', value), { inputMode: 'numeric', autoComplete: 'off' })}
                {input('RG', workerProfile.rg, (value) => updateWorker('rg', value), { autoComplete: 'off' })}
                {input('Data de nascimento', workerProfile.date_of_birth, (value) => updateWorker('date_of_birth', value), { type: 'date', autoComplete: 'bday' })}
                {input('Telefone', workerProfile.phone, (value) => updateWorker('phone', value), { type: 'tel', inputMode: 'tel', autoComplete: 'tel' })}
                {input('CEP', workerProfile.postal_code, (value) => updateWorker('postal_code', value), { inputMode: 'numeric', autoComplete: 'postal-code' })}
                {input('Cidade', workerProfile.city, (value) => updateWorker('city', value), { autoComplete: 'address-level2' })}
                {input('Estado', workerProfile.state, (value) => updateWorker('state', value), { autoComplete: 'address-level1', maxLength: 2 })}
              </div>
              {input('Endereço', workerProfile.address, (value) => updateWorker('address', value), { autoComplete: 'street-address' })}
              <label className="block space-y-1.5"><span className="text-sm font-medium text-gray-700">Bio</span><TextArea value={workerProfile.bio} onChange={(event) => updateWorker('bio', event.target.value)} rows={3} maxLength={1200}  /></label>
              <label className="block space-y-1.5"><span className="text-sm font-medium text-gray-700">Experiência</span><TextArea value={workerProfile.experience} onChange={(event) => updateWorker('experience', event.target.value)} rows={4} maxLength={3000}  /></label>
              {input('Especialidades (separadas por vírgula)', workerProfile.specialties, (value) => updateWorker('specialties', value))}

              <div className="space-y-3 border-t border-gray-100 pt-5">
                <h3 className="font-semibold text-gray-900">Arquivos do perfil</h3>
                {fileInput('Foto de perfil', 'image/jpeg,image/png,image/webp', setProfilePhotoFile, workerProfile.profile_photo_path, 'user')}
                <CameraCapture label="foto de perfil" onCapture={setProfilePhotoFile} />
                {fileInput('Selfie de verificação', 'image/jpeg,image/png,image/webp', setSelfieFile, workerProfile.selfie_verification_path, 'user')}
                <CameraCapture label="selfie de verificação" onCapture={setSelfieFile} />
              </div>
            </>
          ) : (
            <>
              <h2 className="text-lg font-semibold text-gray-900">Dados do restaurante</h2>
              {input('Razão social', restaurantProfile.legal_name, (value) => updateRestaurant('legal_name', value))}
              {input('Nome fantasia', restaurantProfile.trade_name, (value) => updateRestaurant('trade_name', value))}
              <div className="grid gap-4 sm:grid-cols-2">
                {input('CNPJ', restaurantProfile.cnpj, (value) => updateRestaurant('cnpj', value), { inputMode: 'numeric', autoComplete: 'off' })}
                {input('Telefone', restaurantProfile.phone, (value) => updateRestaurant('phone', value), { type: 'tel', inputMode: 'tel', autoComplete: 'tel' })}
                {input('WhatsApp', restaurantProfile.whatsapp, (value) => updateRestaurant('whatsapp', value), { type: 'tel', inputMode: 'tel' })}
                {input('CEP', restaurantProfile.postal_code, (value) => updateRestaurant('postal_code', value), { inputMode: 'numeric', autoComplete: 'postal-code' })}
                {input('Cidade', restaurantProfile.city, (value) => updateRestaurant('city', value), { autoComplete: 'address-level2' })}
                {input('Estado', restaurantProfile.state, (value) => updateRestaurant('state', value), { autoComplete: 'address-level1', maxLength: 2 })}
              </div>
              {input('Endereço', restaurantProfile.address, (value) => updateRestaurant('address', value), { autoComplete: 'street-address' })}
              <label className="block space-y-1.5"><span className="text-sm font-medium text-gray-700">Descrição</span><TextArea value={restaurantProfile.description} onChange={(event) => updateRestaurant('description', event.target.value)} rows={4} maxLength={2000}  /></label>

              <div className="space-y-3 border-t border-gray-100 pt-5">
                <h3 className="font-semibold text-gray-900">Imagens do estabelecimento</h3>
                {fileInput('Logo', 'image/jpeg,image/png,image/webp', setLogoFile, restaurantProfile.logo_path, 'environment')}
                <CameraCapture label="logo" facingMode="environment" onCapture={setLogoFile} />
                <label className="block space-y-2">
                  <span className="text-sm font-medium text-gray-700">Fotos do estabelecimento</span>
                  <TextInput type="file" accept="image/jpeg,image/png,image/webp" capture="environment" multiple onChange={handleCompanyPhotos} className="w-full" />
                  <span className="text-xs text-gray-500">{restaurantProfile.company_photos.length} foto(s) salva(s); até 10 MB por arquivo.</span>
                </label>
                <CameraCapture label="foto do estabelecimento" facingMode="environment" onCapture={(file) => setCompanyPhotoFiles((current) => [...current, file])} />
              </div>
            </>
          )}

          <Button variant="primary" type="submit" busy={saving} disabled={saving} className="w-full px-5 text-base">
            {saving ? 'Salvando perfil...' : 'Salvar perfil'}
          </Button>
        </form>
      </section>
    </main>
  );
}