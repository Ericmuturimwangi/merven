"use client";

import Image from "next/image";
import { deleteImageAction, moveImageAction, updateImageAction, uploadImageAction } from "@/server/admin/actions";
import { Field, FormMessage, SubmitButton, inputClass, invalidProps, useAdminForm } from "./form-bits";

export type AdminImage = { id: string; url: string; alt: string; width: number; height: number; colour: string | null };

/** "Any colour" plus the product's variant colours. A saved colour no longer offered is kept as an option. */
function ColourSelect({ id, colours, defaultValue, disabled }: { id: string; colours: string[]; defaultValue?: string | null; disabled?: boolean }) {
  const options = defaultValue && !colours.includes(defaultValue) ? [...colours, defaultValue] : colours;
  return (
    <select id={id} name="colour" defaultValue={defaultValue ?? ""} disabled={disabled} className={`${inputClass} text-xs`}>
      <option value="">Any colour</option>
      {options.map((c) => (
        <option key={c} value={c}>
          {c}
        </option>
      ))}
    </select>
  );
}

function ImageCard({ image, index, count, colours }: { image: AdminImage; index: number; count: number; colours: string[] }) {
  const alt = useAdminForm(updateImageAction);
  const move = useAdminForm(moveImageAction);
  const del = useAdminForm(deleteImageAction);
  return (
    <li className="space-y-2">
      <div className="relative aspect-[4/5] bg-ivory-deep">
        <Image src={image.url} alt={image.alt} fill sizes="200px" className="object-cover" />
        {index === 0 && <span className="absolute left-2 top-2 bg-ivory px-2 py-0.5 text-xs">Main</span>}
      </div>
      <form {...alt.formProps} className="space-y-1">
        <input type="hidden" name="imageId" value={image.id} />
        <label htmlFor={`alt-${image.id}`} className="sr-only">
          Image description
        </label>
        <input id={`alt-${image.id}`} name="alt" defaultValue={image.alt} maxLength={200} className={`${inputClass} text-xs`} {...invalidProps(alt.state, "alt", `alt-${image.id}`)} />
        {colours.length > 0 && (
          <>
            <label htmlFor={`colour-${image.id}`} className="sr-only">
              Colour shown
            </label>
            <ColourSelect id={`colour-${image.id}`} colours={colours} defaultValue={image.colour} />
          </>
        )}
        <SubmitButton pending={alt.pending} variant="secondary" className="w-full px-2 py-1 text-xs">
          Save
        </SubmitButton>
      </form>
      <div className="flex gap-1">
        <form {...move.formProps} className="flex flex-1 gap-1">
          <input type="hidden" name="imageId" value={image.id} />
          <SubmitButton pending={move.pending} variant="secondary" name="direction" value="up" className="flex-1 px-2 py-1 text-xs" >
            <span aria-hidden>←</span>
            <span className="sr-only">Move earlier</span>
          </SubmitButton>
          <SubmitButton pending={move.pending} variant="secondary" name="direction" value="down" className="flex-1 px-2 py-1 text-xs">
            <span aria-hidden>→</span>
            <span className="sr-only">Move later</span>
          </SubmitButton>
        </form>
        <form
          {...del.formProps}
          onSubmit={(e) => {
            if (!confirm("Remove this image?")) return e.preventDefault();
            del.formProps.onSubmit(e);
          }}
        >
          <input type="hidden" name="imageId" value={image.id} />
          <SubmitButton pending={del.pending} variant="danger" className="px-2 py-1 text-xs">
            Remove
          </SubmitButton>
        </form>
      </div>
      <FormMessage state={!alt.state.ok ? alt.state : !move.state.ok ? move.state : del.state} />
      <span className="sr-only">
        Image {index + 1} of {count}
      </span>
    </li>
  );
}

function UploadForm({ productId, disabled, colours }: { productId: string; disabled: boolean; colours: string[] }) {
  const { state, pending, formProps } = useAdminForm(uploadImageAction, { resetOnSuccess: true });
  return (
    <form {...formProps} className="space-y-3 border border-dashed border-line p-4">
      <p className="text-sm font-medium">Upload an image</p>
      <input type="hidden" name="productId" value={productId} />
      <Field label="Image file" name="file" id="image-file" state={state} hint="JPEG, PNG or WebP · up to 5 MB · at least 400px. Portrait 4:5 looks best.">
        <input id="image-file" name="file" type="file" required accept="image/jpeg,image/png,image/webp" disabled={disabled} className="block w-full text-sm" />
      </Field>
      <Field label="Description (alt text)" name="alt" id="image-alt" state={state} hint="Describe the garment for screen readers, e.g. “Emerald wrap dress, front view”.">
        <input id="image-alt" name="alt" required maxLength={200} disabled={disabled} className={inputClass} {...invalidProps(state, "alt", "image-alt")} />
      </Field>
      {colours.length > 0 && (
        <Field label="Colour shown" name="colour" id="image-colour" state={state} hint="Choosing this colour on the product page shows this photo.">
          <ColourSelect id="image-colour" colours={colours} disabled={disabled} />
        </Field>
      )}
      <div className="flex items-center gap-4">
        <SubmitButton pending={pending || disabled}>{pending ? "Uploading…" : "Upload"}</SubmitButton>
        <FormMessage state={state} />
      </div>
    </form>
  );
}

export function ImageManager({ productId, images, max, colours }: { productId: string; images: AdminImage[]; max: number; colours: string[] }) {
  return (
    <div className="space-y-6">
      {images.length > 0 ? (
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {images.map((img, i) => (
            <ImageCard key={`${img.id}-${i}-${img.alt}-${img.colour ?? ""}`} image={img} index={i} count={images.length} colours={colours} />
          ))}
        </ul>
      ) : (
        <p className="text-sm text-stone">No images yet. Products need at least one image to be published.</p>
      )}
      <UploadForm productId={productId} disabled={images.length >= max} colours={colours} />
    </div>
  );
}
