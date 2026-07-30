using TaxiNow.Storage;
using Xunit;

namespace TaxiNow.Storage.Tests;

public sealed class StoragePathsTests
{
    [Fact]
    public void EmptyFolder_CanBeClaimedAndMarked()
    {
        var root = Path.Combine(
            Path.GetTempPath(),
            "TaxiNow.Tests",
            Guid.NewGuid().ToString("N"));
        try
        {
            Directory.CreateDirectory(root);
            var paths = new StoragePaths(root);

            Assert.True(paths.CanClaimOwnership());
            paths.EnsureCreated();
            paths.WriteOwnershipMarker();

            Assert.True(paths.HasOwnershipMarker());
        }
        finally
        {
            if (Directory.Exists(root))
            {
                Directory.Delete(root, recursive: true);
            }
        }
    }

    [Fact]
    public void FolderWithUnrelatedContent_CannotBeClaimed()
    {
        var root = Path.Combine(
            Path.GetTempPath(),
            "TaxiNow.Tests",
            Guid.NewGuid().ToString("N"));
        try
        {
            Directory.CreateDirectory(root);
            File.WriteAllText(Path.Combine(root, "family-photo.txt"), "not TaxiNow");

            Assert.False(new StoragePaths(root).CanClaimOwnership());
        }
        finally
        {
            if (Directory.Exists(root))
            {
                Directory.Delete(root, recursive: true);
            }
        }
    }

    [Fact]
    public void MarkerMustContainExpectedSignature()
    {
        var root = Path.Combine(
            Path.GetTempPath(),
            "TaxiNow.Tests",
            Guid.NewGuid().ToString("N"));
        try
        {
            Directory.CreateDirectory(root);
            var paths = new StoragePaths(root);
            File.WriteAllText(paths.OwnershipMarkerPath, "another application");

            Assert.False(paths.HasOwnershipMarker());
        }
        finally
        {
            if (Directory.Exists(root))
            {
                Directory.Delete(root, recursive: true);
            }
        }
    }
}
