import {
  Controller,
  FileTypeValidator,
  HttpStatus,
  MaxFileSizeValidator,
  ParseFilePipe,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Roles } from '../admin/decorators/roles.decorator';
import { RolesGuard } from '../admin/guards/roles.guard';
import { StaffAuthGuard } from '../admin/guards/staff-auth.guard';
import { MAX_IMAGE_BYTES, StorageService } from '../storage/storage.service';

/**
 * The subset of a multer file this controller reads. Declared locally so the
 * backend needs no @types/multer dependency; FileInterceptor's default memory
 * storage populates `buffer`.
 */
interface UploadedImage {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

/**
 * Operator image uploads (campaign images now; the same storage layer will back
 * verification-screenshot uploads later). OPERATIONS only, ADMIN via the
 * super-role. Returns a `{ url }` the operator then saves onto a campaign — the
 * upload is decoupled from campaign create/edit so a draft image can be swapped
 * without re-submitting the whole form.
 */
@Controller('admin/uploads')
@UseGuards(StaffAuthGuard, RolesGuard)
@Roles('OPERATIONS')
export class AdminUploadController {
  constructor(private readonly storage: StorageService) {}

  @Post('image')
  @UseInterceptors(FileInterceptor('file'))
  async uploadImage(
    @UploadedFile(
      new ParseFilePipe({
        // A missing file, an oversized one, or a non-image is a client error
        // (400) with a clear message — not a 500.
        errorHttpStatusCode: HttpStatus.BAD_REQUEST,
        validators: [
          new MaxFileSizeValidator({ maxSize: MAX_IMAGE_BYTES }),
          // Magic-number check by default; `fallbackToMimetype` degrades to the
          // declared type only when detection can't run (e.g. the `file-type` ESM
          // module under Jest) — a disguised binary is still detected and rejected.
          new FileTypeValidator({
            fileType: /^image\/(png|jpe?g|webp)$/,
            fallbackToMimetype: true,
          }),
        ],
      }),
    )
    file: UploadedImage,
  ): Promise<{ url: string }> {
    const { url } = await this.storage.save({
      buffer: file.buffer,
      mimetype: file.mimetype,
      subdir: 'campaigns',
    });
    return { url };
  }
}
