"use client";

import { useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Camera, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface ProfileCardProps {
  instanceId: string;
  instanceStatus: string;
}

interface Profile {
  name: string | null;
  status: string | null;
  picture: string | null;
}

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const MAX_NAME_LENGTH = 25;
const MAX_BIO_LENGTH = 139;

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function ProfileCard({ instanceId, instanceStatus }: ProfileCardProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [saving, setSaving] = useState(false);

  const [original, setOriginal] = useState<Profile>({ name: null, status: null, picture: null });
  const [name, setName] = useState("");
  const [bio, setBio] = useState("");
  const [picturePreview, setPicturePreview] = useState<string | null>(null);
  const [pictureFile, setPictureFile] = useState<File | null>(null);

  const disabled = instanceStatus !== "connected";

  const isDirty =
    name !== (original.name ?? "") ||
    bio !== (original.status ?? "") ||
    pictureFile !== null;

  useEffect(() => {
    if (disabled) {
      setLoadingProfile(false);
      return;
    }

    apiFetch(`/instances/${instanceId}/profile`)
      .then((data: Profile) => {
        setOriginal(data);
        setName(data.name ?? "");
        setBio(data.status ?? "");
        setPicturePreview(data.picture ?? null);
      })
      .catch(() => {
        // silently show empty fields
      })
      .finally(() => setLoadingProfile(false));
  }, [instanceId, disabled]);

  useEffect(() => {
    return () => {
      if (picturePreview?.startsWith("blob:")) {
        URL.revokeObjectURL(picturePreview);
      }
    };
  }, [picturePreview]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > MAX_FILE_SIZE) {
      toast.error("A imagem deve ter no máximo 5MB");
      return;
    }

    setPictureFile(file);
    setPicturePreview(URL.createObjectURL(file));
    e.target.value = "";
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const body: Record<string, string> = {};

      if (name !== (original.name ?? "")) body.name = name;
      if (bio !== (original.status ?? "")) body.status = bio;
      if (pictureFile) body.picture = await fileToBase64(pictureFile);

      await apiFetch(`/instances/${instanceId}/profile`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });

      setOriginal({ name: name || null, status: bio || null, picture: picturePreview });
      setPictureFile(null);
      toast.success("Perfil atualizado com sucesso");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao salvar perfil");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          Perfil do WhatsApp
          {disabled && (
            <span className="text-xs font-normal text-destructive">
              Instância desconectada
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {loadingProfile ? (
          <div className="space-y-3">
            <div className="flex items-center gap-4">
              <div className="h-16 w-16 animate-pulse rounded-full bg-muted" />
              <div className="flex-1 space-y-2">
                <div className="h-4 w-1/2 animate-pulse rounded bg-muted" />
                <div className="h-4 w-3/4 animate-pulse rounded bg-muted" />
              </div>
            </div>
          </div>
        ) : (
          <div className={cn("space-y-4", disabled && "pointer-events-none opacity-50")}>
            {/* Photo */}
            <div className="flex items-center gap-4">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="group relative h-16 w-16 flex-shrink-0 overflow-hidden rounded-full border-2 border-border bg-muted transition-colors hover:border-primary"
                disabled={disabled || saving}
              >
                {picturePreview ? (
                  <img
                    src={picturePreview}
                    alt="Foto de perfil"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <Camera className="absolute inset-0 m-auto h-6 w-6 text-muted-foreground" />
                )}
                <div className="absolute inset-0 flex items-center justify-center rounded-full bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
                  <Camera className="h-5 w-5 text-white" />
                </div>
              </button>

              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleFileChange}
              />

              <div className="flex-1 space-y-1">
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Clique na foto para alterar
                </p>
                <p className="text-xs text-muted-foreground">PNG, JPG ou WEBP — máx. 5MB</p>
              </div>
            </div>

            {/* Name */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Nome de exibição
                </label>
                <span className="text-xs text-muted-foreground">{name.length}/{MAX_NAME_LENGTH}</span>
              </div>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value.slice(0, MAX_NAME_LENGTH))}
                placeholder="Nome do bot"
                disabled={disabled || saving}
                className="bg-muted border-border"
              />
            </div>

            {/* Bio */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Bio / Status
                </label>
                <span className="text-xs text-muted-foreground">{bio.length}/{MAX_BIO_LENGTH}</span>
              </div>
              <textarea
                value={bio}
                onChange={(e) => setBio(e.target.value.slice(0, MAX_BIO_LENGTH))}
                placeholder="Status de exibição no WhatsApp"
                disabled={disabled || saving}
                rows={2}
                className={cn(
                  "w-full resize-none rounded-md border border-border bg-muted px-3 py-2 text-sm",
                  "placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring",
                  "disabled:cursor-not-allowed disabled:opacity-50"
                )}
              />
            </div>

            {/* Save button */}
            <div className="flex justify-end">
              <button
                onClick={handleSave}
                disabled={!isDirty || saving || disabled}
                className="flex items-center gap-2 rounded-lg bg-amber-fire-500 px-4 py-2 text-sm font-semibold text-[#0F1219] transition-colors hover:bg-amber-fire-400 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                {saving ? "Salvando..." : "Salvar Perfil"}
              </button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
