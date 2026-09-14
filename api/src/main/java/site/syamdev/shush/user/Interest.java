package site.syamdev.shush.user;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

@Entity
@Table(name = "interests")
public class Interest {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Short id;

    @Column(name = "slug", nullable = false, columnDefinition = "text")
    private String slug;

    @Column(name = "label", nullable = false, columnDefinition = "text")
    private String label;

    @Column(name = "popularity", nullable = false)
    private int popularity;

    protected Interest() {
    }

    /** For one somebody types in, rather than one seeded up front. Starts at zero popularity. */
    Interest(String label, String slug) {
        this.label = label;
        this.slug = slug;
        this.popularity = 0;
    }

    public Short getId() {
        return id;
    }

    public String getSlug() {
        return slug;
    }

    public String getLabel() {
        return label;
    }

    public int getPopularity() {
        return popularity;
    }
}
